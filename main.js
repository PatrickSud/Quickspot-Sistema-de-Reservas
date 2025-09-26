import { auth, db } from './firebase-config.js';
import { ui, show, hide, displayMessage, populateSelect } from './ui.js';
import { ADMIN_EMAIL, initialBuildingsData, timeOptions, appId } from './constants.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, collection, onSnapshot, setDoc, getDoc, query, where, serverTimestamp, deleteDoc, addDoc, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- STATE ---
let state = {
    currentUser: null,
    selectedDate: '',
    selectedBuildingId: '',
    selectedFloorId: '',
    selectedStartTime: '',
    selectedEndTime: '',
    selectedDeskId: '',
    liveBuildingsData: {},
    unsubscribeBookings: null,
    unsubscribeMyBookings: null,
    unsubscribeAdminListeners: null,
    isAdminView: false, // Novo: controla a visão do admin
    currentFilters: {
        tag: '',
        status: '',
        search: ''
    },
    currentDeskBookings: [],
    // Dashboard do Utilizador
    userStats: {
        monthlyBookings: 0,
        totalHours: 0,
        favoriteDesk: null,
        usageFrequency: 0,
        weeklyData: [],
        floorDistribution: {},
        upcomingBookings: [],
        favoriteDesks: []
    }
};

// --- UTILITY ---
const isTimeOverlap = (start1, end1, start2, end2) => start1 < end2 && start2 < end1;
const getTodayDateString = () => new Date().toISOString().split('T')[0];

// Função para gerar datas recorrentes
const generateRecurringDates = (startDate, endDate, frequency) => {
    const dates = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
        dates.push(new Date(current));
        
        switch (frequency) {
            case 'daily':
                current.setDate(current.getDate() + 1);
                break;
            case 'weekly':
                current.setDate(current.getDate() + 7);
                break;
            case 'monthly':
                current.setMonth(current.getMonth() + 1);
                break;
        }
    }
    
    return dates;
};

// Função para aplicar filtros
const applyFilters = () => {
    updateDesksUI(state.currentDeskBookings);
};

// Função para mostrar modal com animação
const showModalWithAnimation = (modal, content) => {
    show(modal);
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);
};

// Função para esconder modal com animação
const hideModalWithAnimation = (modal, content) => {
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        hide(modal);
    }, 300);
};

// Função para mostrar modal de sucesso
const showSuccessModal = (message) => {
    ui.successMessage.textContent = message;
    showModalWithAnimation(ui.successModal, ui.successModalContent);
    setTimeout(() => {
        hideModalWithAnimation(ui.successModal, ui.successModalContent);
    }, 2000);
};

// Função para criar skeleton loading
const createSkeletonLoading = () => {
    const skeletonContainer = document.createElement('div');
    skeletonContainer.className = 'skeleton-container bg-gray-900 p-6 rounded-xl border-2 border-gray-700';
    skeletonContainer.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <div class="h-6 bg-gray-700 rounded w-48 animate-pulse"></div>
            <div class="flex gap-4">
                <div class="h-4 bg-gray-700 rounded w-20 animate-pulse"></div>
                <div class="h-4 bg-gray-700 rounded w-20 animate-pulse"></div>
                <div class="h-4 bg-gray-700 rounded w-20 animate-pulse"></div>
            </div>
        </div>
        <div class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));">
            ${Array.from({length: 12}, () => `
                <div class="bg-gray-700 rounded-lg h-20 animate-pulse"></div>
            `).join('')}
        </div>
    `;
    return skeletonContainer;
};

// ===== DASHBOARD DO UTILIZADOR =====

// Função para calcular estatísticas do utilizador
const calculateUserStats = async (bookings) => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Filtrar reservas do mês atual
    const monthlyBookings = bookings.filter(booking => {
        const bookingDate = new Date(booking.bookingDetails.date);
        return bookingDate.getMonth() === currentMonth && bookingDate.getFullYear() === currentYear;
    });
    
    // Calcular tempo total reservado
    let totalMinutes = 0;
    bookings.forEach(booking => {
        const start = booking.bookingDetails.startTime.split(':');
        const end = booking.bookingDetails.endTime.split(':');
        const startMinutes = parseInt(start[0]) * 60 + parseInt(start[1]);
        const endMinutes = parseInt(end[0]) * 60 + parseInt(end[1]);
        totalMinutes += (endMinutes - startMinutes);
    });
    
    const totalHours = Math.round(totalMinutes / 60);
    
    // Encontrar mesa favorita
    const deskCounts = {};
    bookings.forEach(booking => {
        const deskId = booking.locationDetails.deskId;
        deskCounts[deskId] = (deskCounts[deskId] || 0) + 1;
    });
    
    const favoriteDesk = Object.keys(deskCounts).length > 0 
        ? Object.keys(deskCounts).reduce((a, b) => deskCounts[a] > deskCounts[b] ? a : b)
        : null;
    
    // Calcular frequência de uso (dias únicos com reservas)
    const uniqueDays = new Set(bookings.map(booking => booking.bookingDetails.date)).size;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const usageFrequency = Math.round((uniqueDays / daysInMonth) * 100);
    
    // Dados semanais (últimas 4 semanas)
    const weeklyData = [];
    for (let i = 3; i >= 0; i--) {
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - (now.getDay() + 7 * i));
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        
        const weekBookings = bookings.filter(booking => {
            const bookingDate = new Date(booking.bookingDetails.date);
            return bookingDate >= weekStart && bookingDate <= weekEnd;
        });
        
        weeklyData.push({
            week: `Semana ${4 - i}`,
            count: weekBookings.length
        });
    }
    
    // Distribuição por andar
    const floorDistribution = {};
    bookings.forEach(booking => {
        const floorId = booking.locationDetails.floorId;
        const buildingId = booking.locationDetails.buildingId;
        const floorName = state.liveBuildingsData[buildingId]?.floors[floorId]?.name || 'Andar Desconhecido';
        floorDistribution[floorName] = (floorDistribution[floorName] || 0) + 1;
    });
    
    // Próximas reservas (próximas 5)
    const upcomingBookings = bookings
        .filter(booking => new Date(booking.bookingDetails.date) >= now)
        .sort((a, b) => new Date(a.bookingDetails.date) - new Date(b.bookingDetails.date))
        .slice(0, 5);
    
    // Mesas favoritas (top 3)
    const favoriteDesks = Object.entries(deskCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([deskId, count]) => ({ deskId, count }));
    
    return {
        monthlyBookings: monthlyBookings.length,
        totalHours,
        favoriteDesk,
        usageFrequency,
        weeklyData,
        floorDistribution,
        upcomingBookings,
        favoriteDesks
    };
};

// Função para atualizar o dashboard do utilizador
const updateUserDashboard = async () => {
    if (!state.currentUser) return;
    
    try {
        // Buscar todas as reservas do utilizador
        const bookingsRef = collection(db, `/artifacts/${appId}/public/data/bookings`);
        const q = query(bookingsRef, where('userDetails.uid', '==', state.currentUser.uid));
        const snapshot = await getDocs(q);
        const bookings = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        
        // Calcular estatísticas
        const stats = await calculateUserStats(bookings);
        state.userStats = stats;
        
        // Atualizar UI
        ui.monthlyBookings.textContent = stats.monthlyBookings;
        ui.totalHours.textContent = `${stats.totalHours}h`;
        ui.favoriteDesk.textContent = stats.favoriteDesk || '-';
        ui.usageFrequency.textContent = `${stats.usageFrequency}%`;
        
        // Atualizar gráfico semanal
        updateWeeklyChart(stats.weeklyData);
        
        // Atualizar distribuição por andar
        updateFloorDistribution(stats.floorDistribution);
        
        // Atualizar próximas reservas
        updateUpcomingBookings(stats.upcomingBookings);
        
        // Atualizar mesas favoritas
        updateFavoriteDesks(stats.favoriteDesks);
        
    } catch (error) {
        console.error('Erro ao atualizar dashboard:', error);
    }
};

// Função para atualizar gráfico semanal
const updateWeeklyChart = (weeklyData) => {
    const maxCount = Math.max(...weeklyData.map(w => w.count), 1);
    
    ui.weeklyChart.innerHTML = `
        <div class="w-full h-full flex items-end justify-between gap-2">
            ${weeklyData.map(week => {
                const height = (week.count / maxCount) * 100;
                return `
                    <div class="flex flex-col items-center gap-2 flex-1">
                        <div class="w-full bg-gradient-primary rounded-t-lg transition-all duration-500 hover:bg-gradient-secondary" 
                             style="height: ${height}%; min-height: 20px;">
                        </div>
                        <div class="text-xs text-gray-400">${week.week}</div>
                        <div class="text-sm font-semibold text-white">${week.count}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
};

// Função para atualizar distribuição por andar
const updateFloorDistribution = (floorDistribution) => {
    if (Object.keys(floorDistribution).length === 0) {
        ui.floorDistribution.innerHTML = '<div class="text-gray-400">Nenhuma reserva encontrada</div>';
        return;
    }
    
    const total = Object.values(floorDistribution).reduce((sum, count) => sum + count, 0);
    
    ui.floorDistribution.innerHTML = Object.entries(floorDistribution)
        .sort(([,a], [,b]) => b - a)
        .map(([floorName, count]) => {
            const percentage = Math.round((count / total) * 100);
            return `
                <div class="flex items-center justify-between p-3 glass rounded-lg">
                    <span class="text-white font-medium">${floorName}</span>
                    <div class="flex items-center gap-3">
                        <div class="w-20 bg-gray-700 rounded-full h-2">
                            <div class="bg-gradient-primary h-2 rounded-full transition-all duration-500" 
                                 style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-sm text-gray-400 w-8">${count}</span>
                    </div>
                </div>
            `;
        }).join('');
};

// Função para atualizar próximas reservas
const updateUpcomingBookings = (upcomingBookings) => {
    if (upcomingBookings.length === 0) {
        ui.upcomingBookings.innerHTML = '<div class="text-gray-400">Nenhuma reserva futura</div>';
        return;
    }
    
    ui.upcomingBookings.innerHTML = upcomingBookings.map(booking => {
        const buildingName = state.liveBuildingsData[booking.locationDetails.buildingId]?.name || 'Edifício';
        const floorName = state.liveBuildingsData[booking.locationDetails.buildingId]?.floors[booking.locationDetails.floorId]?.name || 'Andar';
        
        return `
            <div class="p-3 glass rounded-lg">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-semibold text-white">${booking.locationDetails.deskId}</p>
                        <p class="text-sm text-gray-400">${buildingName} - ${floorName}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-sm text-white">${booking.bookingDetails.date}</p>
                        <p class="text-xs text-gray-400">${booking.bookingDetails.startTime} - ${booking.bookingDetails.endTime}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

// Função para atualizar mesas favoritas
const updateFavoriteDesks = (favoriteDesks) => {
    if (favoriteDesks.length === 0) {
        ui.favoriteDesks.innerHTML = '<div class="text-gray-400">Nenhuma mesa favorita ainda</div>';
        return;
    }
    
    ui.favoriteDesks.innerHTML = favoriteDesks.map(({ deskId, count }) => `
        <div class="p-3 glass rounded-lg flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-gradient-warning rounded-full flex items-center justify-center">
                    <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path>
                    </svg>
                </div>
                <span class="font-semibold text-white">${deskId}</span>
            </div>
            <span class="text-sm text-gray-400">${count} reservas</span>
        </div>
    `).join('');
};

// --- CORE APP LOGIC ---
const resetState = () => {
    state.selectedDate = ui.dateInput.value;
    state.selectedBuildingId = '';
    state.selectedFloorId = '';
    state.selectedStartTime = '';
    state.selectedEndTime = '';
    state.selectedDeskId = '';
    ui.buildingSelect.value = '';
    ui.floorSelect.value = '';
    ui.startTimeSelect.value = '';
    ui.endTimeSelect.value = '';
};

const goToStep = (step) => {
    const steps = ['step-1', 'step-2', 'step-3'];
    const currentStep = steps.find(s => !document.getElementById(s).classList.contains('hidden'));
    
    if (currentStep) {
        const currentElement = document.getElementById(currentStep);
        currentElement.style.transform = 'translateX(-100%)';
        currentElement.style.opacity = '0';
        
        setTimeout(() => {
            hide(currentElement);
            steps.forEach(s => hide(document.getElementById(s)));
            hide(ui.bookingDetailsSummary);
            
            const newStep = document.getElementById(`step-${step}`);
            show(newStep);
            newStep.style.transform = 'translateX(100%)';
            newStep.style.opacity = '0';
            
            setTimeout(() => {
                newStep.style.transform = 'translateX(0)';
                newStep.style.opacity = '1';
            }, 10);
        }, 300);
    } else {
        steps.forEach(s => hide(document.getElementById(s)));
        hide(ui.bookingDetailsSummary);
        show(document.getElementById(`step-${step}`));
    }
};

// --- DATA & UI UPDATES ---
const updateBookingDetails = () => {
    ui.selectedUserDisplay.textContent = state.currentUser?.email || 'N/A';
    ui.selectedDateDisplay.textContent = state.selectedDate || 'Nenhuma';
    ui.selectedTimeDisplay.textContent = state.selectedStartTime && state.selectedEndTime ? `${state.selectedStartTime} - ${state.selectedEndTime}` : 'Nenhum';
    ui.selectedBuildingDisplay.textContent = state.liveBuildingsData[state.selectedBuildingId]?.name || 'Nenhum';
    ui.selectedFloorDisplay.textContent = state.liveBuildingsData[state.selectedBuildingId]?.floors[state.selectedFloorId]?.name || 'Nenhum';
    ui.selectedDeskDisplay.textContent = state.selectedDeskId || 'Nenhum';
};

const updateDesksUI = (deskBookings) => {
    state.currentDeskBookings = deskBookings;
    
    // Mostrar skeleton loading primeiro
    ui.desksContainer.innerHTML = '';
    const skeleton = createSkeletonLoading();
    ui.desksContainer.appendChild(skeleton);
    
    // Simular carregamento e depois mostrar o conteúdo real
    setTimeout(() => {
        ui.desksContainer.innerHTML = '';
        const floor = state.liveBuildingsData[state.selectedBuildingId].floors[state.selectedFloorId];
        const desks = floor.desks;
    
    // Aplicar filtros
    const filteredDesks = desks.filter(deskId => {
        const desk = typeof deskId === 'string' ? { id: deskId, tags: [] } : deskId;
        const isAvailable = !deskBookings.some(b => b.deskId === desk.id);
        
        // Filtro por tag
        if (state.currentFilters.tag && (!desk.tags || !desk.tags.includes(state.currentFilters.tag))) {
            return false;
        }
        
        // Filtro por status
        if (state.currentFilters.status === 'available' && !isAvailable) return false;
        if (state.currentFilters.status === 'occupied' && isAvailable) return false;
        
        // Filtro por pesquisa
        if (state.currentFilters.search && !desk.id.toLowerCase().includes(state.currentFilters.search.toLowerCase())) {
            return false;
        }
        
        return true;
    });
    
    // Criar o mapa visual do andar
    const floorPlan = document.createElement('div');
    floorPlan.className = 'floor-plan bg-gray-900 p-6 rounded-xl border-2 border-gray-700';
    floorPlan.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-white">Mapa do Andar: ${floor.name}</h3>
            <div class="flex gap-4 text-sm">
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 bg-green-500 rounded"></div>
                    <span class="text-gray-300">Disponível</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 bg-red-500 rounded"></div>
                    <span class="text-gray-300">Ocupado</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="w-4 h-4 bg-blue-500 rounded"></div>
                    <span class="text-gray-300">Selecionado</span>
                </div>
            </div>
        </div>
        <div class="desks-grid grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));">
        </div>
    `;
    
    const desksGrid = floorPlan.querySelector('.desks-grid');
    
    if (filteredDesks.length === 0) {
        desksGrid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">Nenhuma mesa encontrada com os filtros aplicados.</div>';
    } else {
        filteredDesks.forEach(deskId => {
            const desk = typeof deskId === 'string' ? { id: deskId, tags: [] } : deskId;
            const deskElement = document.createElement('div');
            const isAvailable = !deskBookings.some(b => b.deskId === desk.id);
            const isSelected = state.selectedDeskId === desk.id;
            
            // Determinar cor baseada no status
            let bgColor = 'bg-gray-600'; // Padrão
            if (isSelected) {
                bgColor = 'bg-blue-500';
            } else if (isAvailable) {
                bgColor = 'bg-green-500';
            } else {
                bgColor = 'bg-red-500';
            }
            
            deskElement.className = `desk-item ${bgColor} text-white p-3 rounded-lg text-center cursor-pointer transition-all hover:scale-105 shadow-md min-h-[80px] flex flex-col justify-center items-center relative`;
            deskElement.innerHTML = `
                <div class="font-semibold text-sm">${desk.id}</div>
                ${desk.tags && desk.tags.length > 0 ? `<div class="text-xs mt-1 opacity-80">${desk.tags.join(', ')}</div>` : ''}
            `;
            
            if (isAvailable) {
                deskElement.addEventListener('click', () => {
                    state.selectedDeskId = desk.id;
                    updateBookingDetails();
                    hide(document.getElementById('step-3'));
                    show(ui.bookingDetailsSummary);
                    
                    // Atualizar visualização
                    document.querySelectorAll('.desk-item').forEach(d => {
                        d.classList.remove('bg-blue-500');
                        if (!deskBookings.some(b => b.deskId === d.textContent.trim().split('\n')[0])) {
                            d.classList.add('bg-green-500');
                        }
                    });
                    deskElement.classList.remove('bg-green-500');
                    deskElement.classList.add('bg-blue-500');
                });
            } else {
                deskElement.classList.add('cursor-not-allowed');
            }
            
            desksGrid.appendChild(deskElement);
        });
    }
    
    ui.desksContainer.appendChild(floorPlan);
    }, 800); // Delay para mostrar o skeleton
};

const updateMyBookingsUI = (bookings) => {
    ui.myBookingsList.innerHTML = '';
    if (bookings.length === 0) {
        ui.myBookingsList.innerHTML = '<p class="text-center text-gray-500">Não tem reservas ativas.</p>';
    } else {
        bookings.sort((a,b) => new Date(`${a.date} ${a.startTime}`) - new Date(`${b.date} ${b.startTime}`));
        bookings.forEach(booking => {
            const buildingName = state.liveBuildingsData[booking.buildingId]?.name || 'Edifício Removido';
            const floorName = state.liveBuildingsData[booking.buildingId]?.floors[booking.floorId]?.name || 'Andar Removido';
            const item = document.createElement('div');
            item.className = 'my-booking-item flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 card-modern rounded-xl';
            item.innerHTML = `<div><p class="font-medium text-white">${booking.deskId} (${buildingName}, ${floorName})</p><p class="text-sm text-gray-300">${booking.date} das ${booking.startTime} às ${booking.endTime}</p></div><button class="cancel-button mt-2 sm:mt-0 bg-gradient-error text-white px-3 py-1 rounded-full text-sm font-medium hover:shadow-lg btn-modern" data-booking-id="${booking.id}">Cancelar</button>`;
            ui.myBookingsList.appendChild(item);
        });
        document.querySelectorAll('.cancel-button').forEach(button => button.addEventListener('click', e => cancelBooking(e.target.dataset.bookingId)));
    }
    
    // Atualizar dashboard após atualizar reservas
    updateUserDashboard();
};

// --- ADMIN DASHBOARD ---

// Objeto para guardar o estado temporário do modal
let modalState = {
    onSave: null,
};

// Função para mostrar e configurar o modal
const showModal = (title, contentHtml, onSaveCallback) => {
    ui.admin.modal.title.textContent = title;
    ui.admin.modal.content.innerHTML = contentHtml;
    modalState.onSave = onSaveCallback;
    showModalWithAnimation(ui.admin.modal.container, ui.genericModalContent);
};

// Função para esconder o modal
const hideModal = () => {
    hideModalWithAnimation(ui.admin.modal.container, ui.genericModalContent);
    modalState.onSave = null;
    ui.admin.modal.content.innerHTML = '';
};

// Substitua a sua função renderLayoutManager por esta versão
const renderLayoutManager = () => {
    const manager = ui.admin.layoutManager;
    manager.innerHTML = ''; 

    if (Object.keys(state.liveBuildingsData).length === 0) {
        manager.innerHTML = '<p class="text-center text-gray-500">Nenhum edifício criado.</p>';
        return;
    }

    for (const buildingId in state.liveBuildingsData) {
        const building = state.liveBuildingsData[buildingId];
        const buildingEl = document.createElement('div');
        buildingEl.className = 'bg-gray-800 p-4 rounded-lg';
        buildingEl.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <h4 class="text-lg font-bold text-white"><span class="editable cursor-pointer hover:text-blue-400" data-type="building" data-id="${buildingId}">${building.name}</span></h4>
                <button class="remove-btn text-red-400 hover:text-red-300 text-sm font-bold" data-type="building" data-id="${buildingId}">Remover</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-700 space-y-2" id="floors-container-${buildingId}"></div>
            <button class="add-btn mt-3 text-sm bg-blue-800 text-white py-1 px-3 rounded hover:bg-blue-700" data-type="floor" data-parent-id="${buildingId}">Adicionar Andar</button>
        `;

        const floorsContainer = buildingEl.querySelector(`#floors-container-${buildingId}`);
        for (const floorId in building.floors) {
            const floor = building.floors[floorId];
            const floorEl = document.createElement('div');
            floorEl.className = 'bg-gray-700 p-3 rounded-md';
            floorEl.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <p class="font-semibold text-gray-200"><span class="editable cursor-pointer hover:text-blue-400" data-type="floor" data-id="${floorId}" data-parent-id="${buildingId}">${floor.name}</span></p>
                    <button class="remove-btn text-red-500 hover:text-red-400 text-xs font-bold" data-type="floor" data-id="${floorId}" data-parent-id="${buildingId}">Remover</button>
                </div>
                <div class="flex flex-wrap gap-2" id="desks-container-${floorId}"></div>
                <button class="add-btn mt-2 text-xs bg-indigo-800 text-white py-1 px-2 rounded hover:bg-indigo-700" data-type="desk" data-parent-id="${floorId}" data-grandparent-id="${buildingId}">Adicionar Mesas</button>
            `;

            const desksContainer = floorEl.querySelector(`#desks-container-${floorId}`);
            floor.desks.forEach(deskId => {
                const desk = typeof deskId === 'string' ? { id: deskId, tags: [] } : deskId;
                const tagsDisplay = desk.tags && desk.tags.length > 0 ? ` (${desk.tags.join(', ')})` : '';
                desksContainer.innerHTML += `
                    <div class="bg-gray-600 px-2 py-1 rounded-full text-xs flex items-center gap-2">
                        <span>${desk.id}${tagsDisplay}</span>
                        <button class="remove-btn text-gray-300 hover:text-white" data-type="desk" data-id="${desk.id}" data-parent-id="${floorId}" data-grandparent-id="${buildingId}">&times;</button>
                    </div>`;
            });
            floorsContainer.appendChild(floorEl);
        }
        manager.appendChild(buildingEl);
    }
};

const saveLayout = async () => {
    try {
        await setDoc(doc(db, `/artifacts/${appId}/public/data/layout/main`), { 
            structure: JSON.stringify(state.liveBuildingsData) 
        });
        displayMessage("Estrutura guardada com sucesso!");
    } catch (error) {
        console.error("Erro ao guardar a estrutura:", error);
        displayMessage("Ocorreu um erro ao guardar a estrutura.", "error");
    }
};

const updateAdminDashboard = async () => {
    // 1. Métricas
    const today = getTodayDateString();
    const bookingsRef = collection(db, `/artifacts/${appId}/public/data/bookings`);
    const qToday = query(bookingsRef, where('date', '==', today));
    const todaySnapshot = await getDocs(qToday);
    const bookingsToday = todaySnapshot.docs.map(doc => doc.data());

    // Taxa de Ocupação
    const totalDesks = Object.values(state.liveBuildingsData).reduce((total, building) => {
        return total + Object.values(building.floors).reduce((subTotal, floor) => subTotal + floor.desks.length, 0);
    }, 0);
    const occupancyRate = totalDesks > 0 ? (bookingsToday.length / totalDesks) * 100 : 0;
    ui.admin.occupancyRate.textContent = `${occupancyRate.toFixed(1)}%`;
    ui.admin.totalBookingsToday.textContent = bookingsToday.length;

    // Lugar Mais Popular (baseado em todas as reservas)
    const allBookingsSnapshot = await getDocs(bookingsRef);
    const allBookings = allBookingsSnapshot.docs.map(doc => doc.data());
    if (allBookings.length > 0) {
        const buildingCounts = allBookings.reduce((acc, booking) => {
            acc[booking.buildingId] = (acc[booking.buildingId] || 0) + 1;
            return acc;
        }, {});
        const popularBuildingId = Object.keys(buildingCounts).sort((a, b) => buildingCounts[b] - buildingCounts[a])[0];
        ui.admin.popularBuilding.textContent = state.liveBuildingsData[popularBuildingId]?.name || 'N/A';
    } else {
        ui.admin.popularBuilding.textContent = 'N/A';
    }

    // 2. Próximas Reservas
    const qNext = query(bookingsRef, where('date', '>=', today), orderBy('date'), orderBy('startTime'), limit(10));
    const nextSnapshot = await getDocs(qNext);
    ui.admin.allBookingsList.innerHTML = '';
    if (nextSnapshot.empty) {
        ui.admin.allBookingsList.innerHTML = '<p class="text-center text-gray-500">Nenhuma reserva futura.</p>';
    } else {
        nextSnapshot.docs.forEach(doc => {
            const booking = doc.data();
            const item = document.createElement('div');
            item.className = 'p-3 bg-gray-800 rounded-lg';
            item.innerHTML = `<p class="font-medium text-sm text-white">${booking.user.email} - ${booking.deskId}</p><p class="text-xs text-gray-400">${booking.date} das ${booking.startTime} às ${booking.endTime}</p>`;
            ui.admin.allBookingsList.appendChild(item);
        });
    }

    // 3. Gestor de Estrutura
    renderLayoutManager();
};

const toggleAdminView = (isAdmin) => {
    state.isAdminView = isAdmin;
    if (isAdmin) {
        hide(ui.admin.userView);
        show(ui.admin.adminView);
        ui.admin.appTitle.textContent = 'Dashboard Admin';
        ui.admin.toggleAdminViewBtn.textContent = 'Fazer Reserva';
        updateAdminDashboard();
    } else {
        hide(ui.admin.adminView);
        show(ui.admin.userView);
        ui.admin.appTitle.textContent = 'Reservar Espaço';
        ui.admin.toggleAdminViewBtn.textContent = 'Dashboard';
        initializeAppUI();
    }
};

// --- FIRESTORE OPERATIONS ---
const fetchLayoutData = async () => {
    const layoutDocRef = doc(db, `/artifacts/${appId}/public/data/layout/main`);
    try {
        const docSnap = await getDoc(layoutDocRef);
        if (docSnap.exists()) {
            state.liveBuildingsData = JSON.parse(docSnap.data().structure);
        } else {
            state.liveBuildingsData = initialBuildingsData;
            await setDoc(layoutDocRef, { structure: JSON.stringify(initialBuildingsData) });
        }
    } catch (error) {
        console.error("Error fetching layout:", error);
        state.liveBuildingsData = initialBuildingsData;
        displayMessage("Não foi possível carregar a estrutura de edifícios.", "error");
    }
};

const listenForBookings = () => {
    if (state.unsubscribeBookings) state.unsubscribeBookings();
    const q = query(collection(db, `/artifacts/${appId}/public/data/bookings`), where('date', '==', state.selectedDate), where('buildingId', '==', state.selectedBuildingId), where('floorId', '==', state.selectedFloorId));
    state.unsubscribeBookings = onSnapshot(q, (snapshot) => {
        const deskBookings = snapshot.docs.map(doc => doc.data()).filter(b => isTimeOverlap(state.selectedStartTime, state.selectedEndTime, b.startTime, b.endTime));
        updateDesksUI(deskBookings);
    }, (error) => console.error("Erro ao escutar reservas:", error));
};

const listenForMyBookings = () => {
    if (state.unsubscribeMyBookings) state.unsubscribeMyBookings();
    const q = query(collection(db, `/artifacts/${appId}/public/data/bookings`), where('userDetails.uid', '==', state.currentUser.uid));
    state.unsubscribeMyBookings = onSnapshot(q, (snapshot) => {
        const myBookings = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        updateMyBookingsUI(myBookings);
    }, (error) => console.error("Erro ao escutar as minhas reservas:", error));
};

const cancelBooking = async (bookingId) => {
    try {
        await deleteDoc(doc(db, `/artifacts/${appId}/public/data/bookings/${bookingId}`));
        displayMessage("Reserva cancelada com sucesso!");
    } catch (error) {
        displayMessage("Erro ao cancelar a reserva.", "error");
    }
};


// --- APP INITIALIZATION & FLOW ---
const initializeAppUI = () => {
    resetState();
    populateSelect(ui.buildingSelect, Object.keys(state.liveBuildingsData).map(id => ({ id, name: state.liveBuildingsData[id].name })), 'Selecione um Edifício');
    populateSelect(ui.floorSelect, [], 'Selecione um Andar');
    populateSelect(ui.startTimeSelect, timeOptions, 'Início');
    populateSelect(ui.endTimeSelect, timeOptions, 'Fim');
    if (state.currentUser) listenForMyBookings();
    updateBookingDetails();
    goToStep(1);
};

const showApp = async () => {
    hide(ui.configErrorBox);
    hide(ui.authSection);
    hide(ui.loadingSpinner);
    show(ui.appSection);
    if(state.currentUser.email === ADMIN_EMAIL) {
        show(ui.admin.toggleAdminViewBtn);
        // Ocultado para dar lugar ao botão de toggle
        // show(ui.admin.manageBtn); 
    } else {
        hide(ui.admin.toggleAdminViewBtn);
    }
    await fetchLayoutData();
    initializeAppUI();
};

const showLogin = () => {
    hide(ui.configErrorBox);
    if(state.unsubscribeMyBookings) state.unsubscribeMyBookings();
    if(state.unsubscribeBookings) state.unsubscribeBookings();
    if(state.unsubscribeAdminListeners) state.unsubscribeAdminListeners();
    state.currentUser = null;
    hide(ui.appSection);
    hide(ui.loadingSpinner);
    show(ui.authSection);
};

// --- EVENT LISTENERS ---
const setupEventListeners = () => {
    // Auth
    ui.loginButton.addEventListener('click', async () => { 
        try { 
            hide(ui.configErrorBox);
            await signInWithEmailAndPassword(auth, ui.emailInput.value, ui.passwordInput.value); 
        } catch (error) { 
            console.error("Login error:", error.code);
            if (error.code === 'auth/operation-not-allowed') {
                show(ui.configErrorBox);
                displayMessage('Erro de configuração do Firebase. Veja o aviso abaixo.', 'error');
                return;
            }
            let message = 'Erro ao entrar. Verifique as suas credenciais.';
            if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                message = 'Utilizador não encontrado. Por favor, cadastre-se primeiro.';
            } else if (error.code === 'auth/wrong-password') {
                message = 'Palavra-passe incorreta. Tente novamente.';
            }
            displayMessage(message, 'error');
        }
    });

    ui.signupButton.addEventListener('click', async () => { 
        try { 
            hide(ui.configErrorBox);
            await createUserWithEmailAndPassword(auth, ui.emailInput.value, ui.passwordInput.value); 
        } catch (error) {
            console.error("Signup error:", error.code);
            if (error.code === 'auth/operation-not-allowed') {
                show(ui.configErrorBox);
                displayMessage('Erro de configuração do Firebase. Veja o aviso abaixo.', 'error');
                return;
            }
            let message = 'Erro ao cadastrar. Tente novamente.';
            if (error.code === 'auth/email-already-in-use') {
                message = 'Este e-mail já está em uso. Tente fazer o login.';
            } else if (error.code === 'auth/weak-password') {
                message = 'A palavra-passe é muito fraca. Deve ter pelo menos 6 caracteres.';
            }
            displayMessage(message, 'error');
        }
    });

    ui.logoutButton.addEventListener('click', () => signOut(auth));
    ui.fillAdminBtn.addEventListener('click', () => { ui.emailInput.value = 'admin@test.com'; ui.passwordInput.value = 'admin123'; });
    ui.fillUserBtn.addEventListener('click', () => { ui.emailInput.value = 'user@test.com'; ui.passwordInput.value = 'user123'; });

    // Booking Flow
    const checkStep1 = () => { ui.nextToFloorBtn.disabled = !(state.selectedDate && state.selectedBuildingId); ui.nextToFloorBtn.classList.toggle('opacity-50', ui.nextToFloorBtn.disabled); ui.nextToFloorBtn.classList.toggle('cursor-not-allowed', ui.nextToFloorBtn.disabled);};
    const checkStep2 = () => { ui.nextToDesksBtn.disabled = !(state.selectedFloorId && state.selectedStartTime && state.selectedEndTime && state.selectedEndTime > state.selectedStartTime); ui.nextToDesksBtn.classList.toggle('opacity-50', ui.nextToDesksBtn.disabled); ui.nextToDesksBtn.classList.toggle('cursor-not-allowed', ui.nextToDesksBtn.disabled);};
    
    ui.dateInput.addEventListener('change', () => { state.selectedDate = ui.dateInput.value; checkStep1(); });
    ui.buildingSelect.addEventListener('change', () => { state.selectedBuildingId = ui.buildingSelect.value; populateSelect(ui.floorSelect, state.selectedBuildingId ? Object.keys(state.liveBuildingsData[state.selectedBuildingId].floors).map(id => ({ id, name: state.liveBuildingsData[state.selectedBuildingId].floors[id].name })) : [], 'Selecione um Andar'); state.selectedFloorId = ''; checkStep1(); checkStep2(); });
    ui.floorSelect.addEventListener('change', () => { state.selectedFloorId = ui.floorSelect.value; checkStep2(); });
    ui.startTimeSelect.addEventListener('change', () => { state.selectedStartTime = ui.startTimeSelect.value; checkStep2(); });
    ui.endTimeSelect.addEventListener('change', () => { state.selectedEndTime = ui.endTimeSelect.value; checkStep2(); });

    ui.nextToFloorBtn.addEventListener('click', () => { updateBookingDetails(); goToStep(2); });
    ui.nextToDesksBtn.addEventListener('click', () => { state.selectedDeskId = ''; updateBookingDetails(); listenForBookings(); goToStep(3); });
    ui.backToBuildingBtn.addEventListener('click', () => goToStep(1));
    ui.backToFloorBtn.addEventListener('click', () => goToStep(2));
    
    ui.bookButton.addEventListener('click', async () => {
        if (!state.selectedDate || !state.selectedBuildingId || !state.selectedFloorId || !state.selectedStartTime || !state.selectedEndTime || !state.selectedDeskId) {
            return displayMessage("Por favor, preencha todos os campos.", "error");
        }

        try {
            const bookingsCollection = collection(db, `/artifacts/${appId}/public/data/bookings`);
            
            // Verificar se é uma reserva recorrente
            if (ui.recurringBooking.checked) {
                const frequency = ui.recurringFrequency.value;
                const endDate = new Date(ui.recurringEndDate.value);
                const startDate = new Date(state.selectedDate);
                
                if (endDate <= startDate) {
                    return displayMessage("A data de fim deve ser posterior à data de início.", "error");
                }
                
                const dates = generateRecurringDates(startDate, endDate, frequency);
                
                for (const date of dates) {
                    const bookingData = {
                        userDetails: {
                            email: state.currentUser.email,
                            uid: state.currentUser.uid
                        },
                        bookingDetails: {
                            date: date.toISOString().split('T')[0],
                            startTime: state.selectedStartTime,
                            endTime: state.selectedEndTime,
                        },
                        locationDetails: {
                            buildingId: state.selectedBuildingId,
                            floorId: state.selectedFloorId,
                            deskId: state.selectedDeskId
                        },
                        createdAt: serverTimestamp(),
                        isRecurring: true
                    };
                    
                    await addDoc(bookingsCollection, bookingData);
                }
                
                showSuccessModal(`${dates.length} reservas recorrentes confirmadas com sucesso!`);
            } else {
                // Reserva única
                const bookingData = {
                    userDetails: {
                        email: state.currentUser.email,
                        uid: state.currentUser.uid
                    },
                    bookingDetails: {
                        date: state.selectedDate,
                        startTime: state.selectedStartTime,
                        endTime: state.selectedEndTime,
                    },
                    locationDetails: {
                        buildingId: state.selectedBuildingId,
                        floorId: state.selectedFloorId,
                        deskId: state.selectedDeskId
                    },
                    createdAt: serverTimestamp(),
                    isRecurring: false
                };
                
                await addDoc(bookingsCollection, bookingData);
                showSuccessModal("Reserva confirmada com sucesso!");
            }
            
            initializeAppUI(); // Reseta a UI para o estado inicial

        } catch (e) {
            console.error("Erro ao fazer a reserva: ", e);
            displayMessage("Ocorreu um erro ao tentar fazer a reserva.", "error");
        }
    });

    // --- Filtros ---
    ui.tagFilter.addEventListener('change', (e) => {
        state.currentFilters.tag = e.target.value;
        applyFilters();
    });
    
    ui.statusFilter.addEventListener('change', (e) => {
        state.currentFilters.status = e.target.value;
        applyFilters();
    });
    
    ui.searchFilter.addEventListener('input', (e) => {
        state.currentFilters.search = e.target.value;
        applyFilters();
    });
    
    ui.clearFiltersBtn.addEventListener('click', () => {
        state.currentFilters = { tag: '', status: '', search: '' };
        ui.tagFilter.value = '';
        ui.statusFilter.value = '';
        ui.searchFilter.value = '';
        applyFilters();
    });
    
    // --- Reservas Recorrentes ---
    ui.recurringBooking.addEventListener('change', (e) => {
        if (e.target.checked) {
            show(ui.recurringOptions);
            // Definir data de fim padrão (1 mês a partir de hoje)
            const endDate = new Date();
            endDate.setMonth(endDate.getMonth() + 1);
            ui.recurringEndDate.value = endDate.toISOString().split('T')[0];
        } else {
            hide(ui.recurringOptions);
        }
    });

    // ===== DASHBOARD DO UTILIZADOR - EVENT LISTENERS =====
    
    // Botão de reserva rápida
    ui.quickBookBtn.addEventListener('click', () => {
        // Voltar ao passo 1 para nova reserva
        goToStep(1);
        // Scroll para o topo
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Botão de ver histórico
    ui.viewHistoryBtn.addEventListener('click', () => {
        // Scroll para a seção de reservas
        document.getElementById('my-bookings-section').scrollIntoView({ 
            behavior: 'smooth' 
        });
    });

    // Botão de exportar dados
    ui.exportDataBtn.addEventListener('click', async () => {
        try {
            if (!state.currentUser) return;
            
            // Buscar todas as reservas do utilizador
            const bookingsRef = collection(db, `/artifacts/${appId}/public/data/bookings`);
            const q = query(bookingsRef, where('userDetails.uid', '==', state.currentUser.uid));
            const snapshot = await getDocs(q);
            const bookings = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            
            // Preparar dados para exportação
            const exportData = bookings.map(booking => ({
                'Data': booking.bookingDetails.date,
                'Hora Início': booking.bookingDetails.startTime,
                'Hora Fim': booking.bookingDetails.endTime,
                'Edifício': state.liveBuildingsData[booking.locationDetails.buildingId]?.name || 'N/A',
                'Andar': state.liveBuildingsData[booking.locationDetails.buildingId]?.floors[booking.locationDetails.floorId]?.name || 'N/A',
                'Mesa': booking.locationDetails.deskId,
                'Status': booking.status || 'Ativa'
            }));
            
            // Converter para CSV
            const csvContent = [
                Object.keys(exportData[0] || {}).join(','),
                ...exportData.map(row => Object.values(row).join(','))
            ].join('\n');
            
            // Criar e baixar arquivo
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `reservas_${state.currentUser.email}_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Mostrar mensagem de sucesso
            showSuccessModal('Dados exportados com sucesso!');
            
        } catch (error) {
            console.error('Erro ao exportar dados:', error);
            alert('Erro ao exportar dados. Tente novamente.');
        }
    });

    // --- Admin Listeners ---
    ui.admin.toggleAdminViewBtn.addEventListener('click', () => toggleAdminView(!state.isAdminView));
    ui.admin.saveBtn.addEventListener('click', saveLayout);
    
    // Modal controls
    ui.admin.modal.cancelBtn.addEventListener('click', hideModal);
    ui.admin.modal.saveBtn.addEventListener('click', () => {
        if (modalState.onSave) {
            modalState.onSave();
        }
    });

    // Botão principal para adicionar um novo edifício
    ui.admin.addBuildingBtn.addEventListener('click', () => {
        const content = `<input type="text" id="modal-input-name" placeholder="Ex: Edifício Principal" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">`;
        showModal('Adicionar Novo Edifício', content, () => {
            const name = document.getElementById('modal-input-name').value;
            if (name) {
                const id = `building-${Date.now()}`;
                state.liveBuildingsData[id] = { name, floors: {} };
                renderLayoutManager();
                hideModal();
            }
        });
    });

    // Listener delegado para todas as ações dentro do gestor
    ui.admin.layoutManager.addEventListener('click', (e) => {
        const target = e.target;
        const { type, id, parentId, grandparentId } = target.dataset;

        // Ações de Adicionar
        if (target.classList.contains('add-btn')) {
            if (type === 'floor') {
                const content = `<input type="text" id="modal-input-name" placeholder="Ex: Andar 1 (TI)" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">`;
                showModal(`Novo Andar para "${state.liveBuildingsData[parentId].name}"`, content, () => {
                    const name = document.getElementById('modal-input-name').value;
                    if (name) {
                        const floorId = `floor-${Date.now()}`;
                        state.liveBuildingsData[parentId].floors[floorId] = { name, desks: [] };
                        renderLayoutManager();
                        hideModal();
                    }
                });
            }
            if (type === 'desk') {
                const content = `
                    <input type="text" id="modal-input-prefix" placeholder="Prefixo (Ex: Mesa, Posto)" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">
                    <input type="number" id="modal-input-quantity" placeholder="Quantidade" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">
                    <input type="number" id="modal-input-start" placeholder="Número Inicial" value="1" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">
                    <div class="mt-4">
                        <label class="block text-sm font-medium text-gray-300 mb-2">Tags (separadas por vírgula):</label>
                        <input type="text" id="modal-input-tags" placeholder="Ex: janela, monitores, silencioso" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">
                    </div>
                `;
                showModal('Adicionar Mesas em Massa', content, () => {
                    const prefix = document.getElementById('modal-input-prefix').value;
                    const quantity = parseInt(document.getElementById('modal-input-quantity').value);
                    const startNum = parseInt(document.getElementById('modal-input-start').value);
                    const tagsInput = document.getElementById('modal-input-tags').value;
                    const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
                    
                    if (prefix && quantity > 0) {
                        for (let i = 0; i < quantity; i++) {
                            const deskId = `${prefix} ${startNum + i}`;
                            const deskObject = { id: deskId, tags: tags };
                            state.liveBuildingsData[grandparentId].floors[parentId].desks.push(deskObject);
                        }
                        renderLayoutManager();
                        hideModal();
                    }
                });
            }
        }

        // Ações de Remover
        if (target.classList.contains('remove-btn')) {
            if (type === 'building' && confirm(`Remover "${state.liveBuildingsData[id].name}"?`)) {
                delete state.liveBuildingsData[id];
            }
            if (type === 'floor' && confirm(`Remover "${state.liveBuildingsData[parentId].floors[id].name}"?`)) {
                delete state.liveBuildingsData[parentId].floors[id];
            }
            if (type === 'desk') {
                const desks = state.liveBuildingsData[grandparentId].floors[parentId].desks;
                const index = desks.indexOf(id);
                if (index > -1) desks.splice(index, 1);
            }
            renderLayoutManager();
        }

        // Ações de Renomear (Editar)
        if (target.classList.contains('editable')) {
            const currentName = target.textContent;
            const content = `<input type="text" id="modal-input-name" value="${currentName}" class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl">`;
            showModal(`Renomear "${currentName}"`, content, () => {
                const newName = document.getElementById('modal-input-name').value;
                if (newName && newName !== currentName) {
                    if (type === 'building') state.liveBuildingsData[id].name = newName;
                    if (type === 'floor') state.liveBuildingsData[parentId].floors[id].name = newName;
                    renderLayoutManager();
                }
                hideModal();
            });
        }
    });
};

// --- AUTH STATE CHANGE HANDLER ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        state.currentUser = user;
        showApp();
    } else {
        showLogin();
    }
});

// --- INITIALIZE ---
ui.dateInput.value = getTodayDateString();
state.selectedDate = ui.dateInput.value;
setupEventListeners();