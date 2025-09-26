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
    },
    // Dashboard do Administrador
    adminStats: {
        totalBookings: 0,
        activeUsers: 0,
        occupancyRate: 0,
        availableDesks: 0,
        dailyData: [],
        buildingDistribution: {},
        topUsers: [],
        recentBookings: []
    },
    // Sistema de Notificações
    notificationSettings: {
        booking: true,
        cancellation: true,
        system: true,
        sound: true
    },
    notificationHistory: [],
    // Sistema de Exportação
    exportSettings: {
        includeStats: true,
        includeCharts: true,
        includeUsers: true
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

// ===== SISTEMA DE NOTIFICAÇÕES =====

// Função para criar uma notificação
const createNotification = (type, title, message, duration = 5000) => {
    const notification = document.createElement('div');
    notification.className = `notification glass rounded-xl p-4 shadow-lg transform transition-all duration-300 translate-x-full opacity-0 max-w-sm`;
    
    // Cores baseadas no tipo
    let bgColor = 'bg-blue-500';
    let icon = '';
    
    switch (type) {
        case 'success':
            bgColor = 'bg-green-500';
            icon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>`;
            break;
        case 'error':
            bgColor = 'bg-red-500';
            icon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>`;
            break;
        case 'warning':
            bgColor = 'bg-yellow-500';
            icon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
            </svg>`;
            break;
        case 'info':
        default:
            bgColor = 'bg-blue-500';
            icon = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>`;
            break;
    }
    
    notification.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-8 h-8 ${bgColor} rounded-full flex items-center justify-center text-white">
                ${icon}
            </div>
            <div class="flex-1 min-w-0">
                <h4 class="text-sm font-semibold text-white">${title}</h4>
                <p class="text-xs text-gray-300 mt-1">${message}</p>
            </div>
            <button class="flex-shrink-0 text-gray-400 hover:text-white transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
    `;
    
    // Adicionar ao container
    ui.notificationsContainer.appendChild(notification);
    
    // Animar entrada
    setTimeout(() => {
        notification.classList.remove('translate-x-full', 'opacity-0');
        notification.classList.add('translate-x-0', 'opacity-100');
    }, 100);
    
    // Event listener para fechar
    const closeBtn = notification.querySelector('button');
    closeBtn.addEventListener('click', () => {
        removeNotification(notification);
    });
    
    // Auto-remover após duração
    if (duration > 0) {
        setTimeout(() => {
            removeNotification(notification);
        }, duration);
    }
    
    // Adicionar ao histórico
    addToNotificationHistory(type, title, message);
    
    // Reproduzir som se habilitado
    if (state.notificationSettings.sound) {
        playNotificationSound();
    }
    
    return notification;
};

// Função para remover notificação
const removeNotification = (notification) => {
    notification.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
};

// Função para adicionar ao histórico
const addToNotificationHistory = (type, title, message) => {
    const notification = {
        id: Date.now(),
        type,
        title,
        message,
        timestamp: new Date().toISOString()
    };
    
    state.notificationHistory.unshift(notification);
    
    // Manter apenas os últimos 50
    if (state.notificationHistory.length > 50) {
        state.notificationHistory = state.notificationHistory.slice(0, 50);
    }
    
    // Salvar no localStorage
    localStorage.setItem('notificationHistory', JSON.stringify(state.notificationHistory));
};

// Função para carregar histórico do localStorage
const loadNotificationHistory = () => {
    const saved = localStorage.getItem('notificationHistory');
    if (saved) {
        state.notificationHistory = JSON.parse(saved);
    }
};

// Função para carregar configurações do localStorage
const loadNotificationSettings = () => {
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
        state.notificationSettings = { ...state.notificationSettings, ...JSON.parse(saved) };
    }
};

// Função para salvar configurações
const saveNotificationSettings = () => {
    localStorage.setItem('notificationSettings', JSON.stringify(state.notificationSettings));
};

// Função para reproduzir som de notificação
const playNotificationSound = () => {
    try {
        // Criar um som simples usando Web Audio API
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
        console.log('Não foi possível reproduzir som de notificação');
    }
};

// Função para mostrar configurações de notificação
const showNotificationSettings = () => {
    // Carregar configurações atuais
    ui.bookingNotifications.checked = state.notificationSettings.booking;
    ui.cancellationNotifications.checked = state.notificationSettings.cancellation;
    ui.systemNotifications.checked = state.notificationSettings.system;
    ui.notificationSound.checked = state.notificationSettings.sound;
    
    // Mostrar modal
    showModalWithAnimation(ui.notificationSettingsModal, ui.notificationSettingsContent);
};

// Função para mostrar histórico de notificações
const showNotificationHistory = () => {
    // Carregar histórico
    loadNotificationHistory();
    
    // Limpar lista
    ui.notificationHistoryList.innerHTML = '';
    
    if (state.notificationHistory.length === 0) {
        ui.notificationHistoryList.innerHTML = '<div class="text-center text-gray-400 py-8">Nenhuma notificação no histórico</div>';
    } else {
        state.notificationHistory.forEach(notification => {
            const item = document.createElement('div');
            item.className = 'p-3 glass rounded-lg';
            
            let icon = '';
            let bgColor = '';
            
            switch (notification.type) {
                case 'success':
                    bgColor = 'bg-green-500';
                    icon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                    </svg>`;
                    break;
                case 'error':
                    bgColor = 'bg-red-500';
                    icon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>`;
                    break;
                case 'warning':
                    bgColor = 'bg-yellow-500';
                    icon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                    </svg>`;
                    break;
                default:
                    bgColor = 'bg-blue-500';
                    icon = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>`;
                    break;
            }
            
            const date = new Date(notification.timestamp);
            const timeString = date.toLocaleString('pt-PT');
            
            item.innerHTML = `
                <div class="flex items-start gap-3">
                    <div class="flex-shrink-0 w-6 h-6 ${bgColor} rounded-full flex items-center justify-center text-white">
                        ${icon}
                    </div>
                    <div class="flex-1 min-w-0">
                        <h4 class="text-sm font-semibold text-white">${notification.title}</h4>
                        <p class="text-xs text-gray-300 mt-1">${notification.message}</p>
                        <p class="text-xs text-gray-400 mt-1">${timeString}</p>
                    </div>
                </div>
            `;
            
            ui.notificationHistoryList.appendChild(item);
        });
    }
    
    // Mostrar modal
    showModalWithAnimation(ui.notificationHistoryModal, ui.notificationHistoryContent);
};

// ===== SISTEMA DE EXPORTAÇÃO =====

// Função para mostrar modal de exportação
const showExportModal = () => {
    // Definir datas padrão (último mês)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);
    
    ui.exportStartDate.value = startDate.toISOString().split('T')[0];
    ui.exportEndDate.value = endDate.toISOString().split('T')[0];
    
    // Carregar configurações
    ui.includeStats.checked = state.exportSettings.includeStats;
    ui.includeCharts.checked = state.exportSettings.includeCharts;
    ui.includeUsers.checked = state.exportSettings.includeUsers;
    
    showModalWithAnimation(ui.exportModal, ui.exportModalContent);
};

// Função para exportar dados em Excel
const exportToExcel = async (data, filename = 'dados_reservas') => {
    try {
        // Criar dados para Excel
        const excelData = data.map(booking => ({
            'Data': booking.bookingDetails?.date || booking.date,
            'Hora Início': booking.bookingDetails?.startTime || booking.startTime,
            'Hora Fim': booking.bookingDetails?.endTime || booking.endTime,
            'Utilizador': booking.userDetails?.email || booking.userEmail || 'N/A',
            'Edifício': state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.name || 'N/A',
            'Andar': state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.floors[booking.locationDetails?.floorId || booking.floorId]?.name || 'N/A',
            'Mesa': booking.locationDetails?.deskId || booking.deskId,
            'Status': booking.status || 'Ativa',
            'Criado em': booking.createdAt ? new Date(booking.createdAt.seconds * 1000).toLocaleString('pt-PT') : 'N/A'
        }));
        
        // Converter para CSV
        const csvContent = [
            Object.keys(excelData[0] || {}).join(','),
            ...excelData.map(row => Object.values(row).map(val => `"${val}"`).join(','))
        ].join('\n');
        
        // Criar e baixar arquivo
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        createNotification('success', 'Exportação Excel', 'Dados exportados para Excel com sucesso!');
        
    } catch (error) {
        console.error('Erro ao exportar para Excel:', error);
        createNotification('error', 'Erro na Exportação', 'Não foi possível exportar os dados para Excel.');
    }
};

// Função para exportar backup em JSON
const exportToJSON = async (data, filename = 'backup_reservas') => {
    try {
        const backupData = {
            exportDate: new Date().toISOString(),
            version: '1.0',
            data: {
                bookings: data,
                buildings: state.liveBuildingsData,
                settings: state.exportSettings
            },
            metadata: {
                totalBookings: data.length,
                buildingsCount: Object.keys(state.liveBuildingsData).length,
                exportType: 'full_backup'
            }
        };
        
        const jsonContent = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        createNotification('success', 'Backup JSON', 'Backup completo exportado com sucesso!');
        
    } catch (error) {
        console.error('Erro ao exportar backup JSON:', error);
        createNotification('error', 'Erro no Backup', 'Não foi possível criar o backup JSON.');
    }
};

// Função para gerar relatório PDF
const generatePDFReport = async (data, options = {}) => {
    try {
        // Criar conteúdo HTML para o PDF
        const htmlContent = createPDFContent(data, options);
        
        // Criar nova janela para impressão
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        // Aguardar carregamento e imprimir
        printWindow.onload = () => {
            printWindow.print();
            printWindow.close();
        };
        
        createNotification('success', 'Relatório PDF', 'Relatório PDF gerado com sucesso!');
        
    } catch (error) {
        console.error('Erro ao gerar PDF:', error);
        createNotification('error', 'Erro no PDF', 'Não foi possível gerar o relatório PDF.');
    }
};

// Função para criar conteúdo HTML do PDF
const createPDFContent = (data, options) => {
    const { title = 'Relatório de Reservas', includeStats = true, includeCharts = false, includeUsers = true } = options;
    
    // Calcular estatísticas
    const stats = calculateReportStats(data);
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .section { margin-bottom: 25px; }
            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
            .stat-card { background: #f5f5f5; padding: 15px; border-radius: 8px; text-align: center; }
            .stat-number { font-size: 24px; font-weight: bold; color: #2563eb; }
            .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #666; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>${title}</h1>
            <p>Gerado em: ${new Date().toLocaleString('pt-PT')}</p>
        </div>
    `;
    
    // Seção de estatísticas
    if (includeStats) {
        html += `
        <div class="section">
            <h2>Estatísticas Gerais</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${stats.totalBookings}</div>
                    <div class="stat-label">Total de Reservas</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.uniqueUsers}</div>
                    <div class="stat-label">Utilizadores Únicos</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.avgBookingsPerDay}</div>
                    <div class="stat-label">Média por Dia</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.occupancyRate}%</div>
                    <div class="stat-label">Taxa de Ocupação</div>
                </div>
            </div>
        </div>
        `;
    }
    
    // Seção de dados detalhados
    html += `
    <div class="section">
        <h2>Detalhes das Reservas</h2>
        <table>
            <thead>
                <tr>
                    <th>Data</th>
                    <th>Hora</th>
                    <th>Utilizador</th>
                    <th>Localização</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    data.forEach(booking => {
        const buildingName = state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.name || 'N/A';
        const floorName = state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.floors[booking.locationDetails?.floorId || booking.floorId]?.name || 'N/A';
        
        html += `
            <tr>
                <td>${booking.bookingDetails?.date || booking.date}</td>
                <td>${booking.bookingDetails?.startTime || booking.startTime} - ${booking.bookingDetails?.endTime || booking.endTime}</td>
                <td>${booking.userDetails?.email || booking.userEmail || 'N/A'}</td>
                <td>${buildingName} - ${floorName} - ${booking.locationDetails?.deskId || booking.deskId}</td>
                <td>${booking.status || 'Ativa'}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    </div>
    
    <div class="footer">
        <p>Relatório gerado automaticamente pelo Sistema de Reservas Quickspot</p>
    </div>
    </body>
    </html>
    `;
    
    return html;
};

// Função para calcular estatísticas do relatório
const calculateReportStats = (data) => {
    const uniqueUsers = new Set(data.map(booking => booking.userDetails?.uid || booking.userId)).size;
    const totalBookings = data.length;
    
    // Calcular média de reservas por dia
    const dateCounts = {};
    data.forEach(booking => {
        const date = booking.bookingDetails?.date || booking.date;
        dateCounts[date] = (dateCounts[date] || 0) + 1;
    });
    const avgBookingsPerDay = Object.keys(dateCounts).length > 0 
        ? Math.round(totalBookings / Object.keys(dateCounts).length) 
        : 0;
    
    // Calcular taxa de ocupação (simplificada)
    const totalDesks = Object.values(state.liveBuildingsData).reduce((total, building) => {
        return total + Object.values(building.floors).reduce((floorTotal, floor) => {
            return floorTotal + floor.desks.length;
        }, 0);
    }, 0);
    
    const occupancyRate = totalDesks > 0 ? Math.round((totalBookings / totalDesks) * 100) : 0;
    
    return {
        totalBookings,
        uniqueUsers,
        avgBookingsPerDay,
        occupancyRate
    };
};

// Função para buscar dados com filtros
const fetchFilteredData = async (startDate, endDate) => {
    try {
        const bookingsRef = collection(db, `/artifacts/${appId}/public/data/bookings`);
        const snapshot = await getDocs(bookingsRef);
        let bookings = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        
        // Aplicar filtros de data
        if (startDate && endDate) {
            bookings = bookings.filter(booking => {
                const bookingDate = booking.bookingDetails?.date || booking.date;
                return bookingDate >= startDate && bookingDate <= endDate;
            });
        }
        
        return bookings;
    } catch (error) {
        console.error('Erro ao buscar dados:', error);
        return [];
    }
};

// Função para mostrar modal de relatório personalizado
const showCustomReportModal = () => {
    // Definir valores padrão
    ui.customReportTitle.value = `Relatório Personalizado - ${new Date().toLocaleDateString('pt-PT')}`;
    ui.customReportDescription.value = 'Relatório gerado automaticamente com dados personalizados.';
    
    // Mostrar modal
    showModalWithAnimation(ui.customReportModal, ui.customReportContent);
};

// ===== DASHBOARD DO ADMINISTRADOR =====

// Função para calcular estatísticas administrativas
const calculateAdminStats = async (allBookings) => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Total de reservas
    const totalBookings = allBookings.length;
    
    // Utilizadores únicos
    const uniqueUsers = new Set(allBookings.map(booking => booking.userDetails?.uid || booking.userId)).size;
    
    // Calcular total de mesas disponíveis
    let totalDesks = 0;
    Object.values(state.liveBuildingsData).forEach(building => {
        Object.values(building.floors).forEach(floor => {
            totalDesks += floor.desks.length;
        });
    });
    
    // Reservas ativas hoje
    const todayBookings = allBookings.filter(booking => {
        const bookingDate = booking.bookingDetails?.date || booking.date;
        return bookingDate === today;
    });
    
    // Taxa de ocupação (reservas ativas hoje / total de mesas)
    const occupancyRate = totalDesks > 0 ? Math.round((todayBookings.length / totalDesks) * 100) : 0;
    
    // Mesas disponíveis hoje
    const availableDesks = Math.max(0, totalDesks - todayBookings.length);
    
    // Dados diários (últimos 7 dias)
    const dailyData = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(now.getDate() - i);
        const dateString = date.toISOString().split('T')[0];
        
        const dayBookings = allBookings.filter(booking => {
            const bookingDate = booking.bookingDetails?.date || booking.date;
            return bookingDate === dateString;
        });
        
        dailyData.push({
            date: dateString,
            day: date.toLocaleDateString('pt-PT', { weekday: 'short' }),
            count: dayBookings.length
        });
    }
    
    // Distribuição por edifício
    const buildingDistribution = {};
    allBookings.forEach(booking => {
        const buildingId = booking.locationDetails?.buildingId || booking.buildingId;
        const buildingName = state.liveBuildingsData[buildingId]?.name || 'Edifício Desconhecido';
        buildingDistribution[buildingName] = (buildingDistribution[buildingName] || 0) + 1;
    });
    
    // Top utilizadores (mais reservas)
    const userCounts = {};
    allBookings.forEach(booking => {
        const userId = booking.userDetails?.uid || booking.userId;
        const userEmail = booking.userDetails?.email || booking.userEmail || 'Utilizador Desconhecido';
        if (userId) {
            if (!userCounts[userId]) {
                userCounts[userId] = { email: userEmail, count: 0 };
            }
            userCounts[userId].count++;
        }
    });
    
    const topUsers = Object.entries(userCounts)
        .sort(([,a], [,b]) => b.count - a.count)
        .slice(0, 5)
        .map(([userId, data]) => ({ userId, ...data }));
    
    // Reservas recentes (últimas 10)
    const recentBookings = allBookings
        .sort((a, b) => {
            const dateA = new Date(a.bookingDetails?.date || a.date);
            const dateB = new Date(b.bookingDetails?.date || b.date);
            return dateB - dateA;
        })
        .slice(0, 10);
    
    return {
        totalBookings,
        activeUsers: uniqueUsers,
        occupancyRate,
        availableDesks,
        dailyData,
        buildingDistribution,
        topUsers,
        recentBookings
    };
};

// Função para atualizar o dashboard do administrador
const updateAdminDashboard = async () => {
    try {
        // Buscar todas as reservas
        const bookingsRef = collection(db, `/artifacts/${appId}/public/data/bookings`);
        const snapshot = await getDocs(bookingsRef);
        const allBookings = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        
        // Calcular estatísticas
        const stats = await calculateAdminStats(allBookings);
        state.adminStats = stats;
        
        // Atualizar UI
        ui.totalBookings.textContent = stats.totalBookings;
        ui.activeUsers.textContent = stats.activeUsers;
        ui.occupancyRate.textContent = `${stats.occupancyRate}%`;
        ui.availableDesks.textContent = stats.availableDesks;
        
        // Atualizar gráfico diário
        updateDailyBookingsChart(stats.dailyData);
        
        // Atualizar distribuição por edifício
        updateBuildingDistribution(stats.buildingDistribution);
        
        // Atualizar top utilizadores
        updateTopUsers(stats.topUsers);
        
        // Atualizar reservas recentes
        updateRecentBookings(stats.recentBookings);
        
    } catch (error) {
        console.error('Erro ao atualizar dashboard admin:', error);
    }
};

// Função para atualizar gráfico de reservas diárias
const updateDailyBookingsChart = (dailyData) => {
    const maxCount = Math.max(...dailyData.map(d => d.count), 1);
    
    ui.dailyBookingsChart.innerHTML = `
        <div class="w-full h-full flex items-end justify-between gap-2">
            ${dailyData.map(day => {
                const height = (day.count / maxCount) * 100;
                return `
                    <div class="flex flex-col items-center gap-2 flex-1">
                        <div class="w-full bg-gradient-success rounded-t-lg transition-all duration-500 hover:bg-gradient-primary" 
                             style="height: ${height}%; min-height: 20px;">
                        </div>
                        <div class="text-xs text-gray-400">${day.day}</div>
                        <div class="text-sm font-semibold text-white">${day.count}</div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
};

// Função para atualizar distribuição por edifício
const updateBuildingDistribution = (buildingDistribution) => {
    if (Object.keys(buildingDistribution).length === 0) {
        ui.buildingDistribution.innerHTML = '<div class="text-gray-400">Nenhuma reserva encontrada</div>';
        return;
    }
    
    const total = Object.values(buildingDistribution).reduce((sum, count) => sum + count, 0);
    
    ui.buildingDistribution.innerHTML = Object.entries(buildingDistribution)
        .sort(([,a], [,b]) => b - a)
        .map(([buildingName, count]) => {
            const percentage = Math.round((count / total) * 100);
            return `
                <div class="flex items-center justify-between p-3 glass rounded-lg">
                    <span class="text-white font-medium">${buildingName}</span>
                    <div class="flex items-center gap-3">
                        <div class="w-20 bg-gray-700 rounded-full h-2">
                            <div class="bg-gradient-warning h-2 rounded-full transition-all duration-500" 
                                 style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-sm text-gray-400 w-8">${count}</span>
                    </div>
                </div>
            `;
        }).join('');
};

// Função para atualizar top utilizadores
const updateTopUsers = (topUsers) => {
    if (topUsers.length === 0) {
        ui.topUsers.innerHTML = '<div class="text-gray-400">Nenhum utilizador encontrado</div>';
        return;
    }
    
    ui.topUsers.innerHTML = topUsers.map((user, index) => `
        <div class="p-3 glass rounded-lg flex items-center justify-between">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center">
                    <span class="text-white font-bold text-sm">${index + 1}</span>
                </div>
                <div>
                    <p class="font-semibold text-white text-sm">${user.email}</p>
                    <p class="text-xs text-gray-400">${user.count} reservas</p>
                </div>
            </div>
            <div class="text-right">
                <div class="w-12 bg-gray-700 rounded-full h-2">
                    <div class="bg-gradient-primary h-2 rounded-full transition-all duration-500" 
                         style="width: ${(user.count / topUsers[0].count) * 100}%"></div>
                </div>
            </div>
        </div>
    `).join('');
};

// Função para atualizar reservas recentes
const updateRecentBookings = (recentBookings) => {
    if (recentBookings.length === 0) {
        ui.recentBookings.innerHTML = '<div class="text-gray-400">Nenhuma reserva encontrada</div>';
        return;
    }
    
    ui.recentBookings.innerHTML = recentBookings.map(booking => {
        const buildingName = state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.name || 'Edifício';
        const floorName = state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.floors[booking.locationDetails?.floorId || booking.floorId]?.name || 'Andar';
        const userEmail = booking.userDetails?.email || booking.userEmail || 'Utilizador';
        const date = booking.bookingDetails?.date || booking.date;
        const startTime = booking.bookingDetails?.startTime || booking.startTime;
        const endTime = booking.bookingDetails?.endTime || booking.endTime;
        
        return `
            <div class="p-3 glass rounded-lg">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-semibold text-white text-sm">${booking.locationDetails?.deskId || booking.deskId}</p>
                        <p class="text-xs text-gray-400">${buildingName} - ${floorName}</p>
                        <p class="text-xs text-gray-400">${userEmail}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-xs text-white">${date}</p>
                        <p class="text-xs text-gray-400">${startTime} - ${endTime}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

// Função para alternar entre dashboard e gestor de espaços
const toggleAdminSpaceManager = (showSpaceManager = false) => {
    if (showSpaceManager) {
        ui.adminDashboard.classList.add('hidden');
        ui.spaceManager.classList.remove('hidden');
        // Renderizar o gestor de espaços com os dados existentes
        renderLayoutManager();
    } else {
        ui.adminDashboard.classList.remove('hidden');
        ui.spaceManager.classList.add('hidden');
        // Atualizar dashboard quando voltar
        updateAdminDashboard();
    }
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
        bookings.sort((a,b) => {
            const dateA = a.bookingDetails?.date || a.date;
            const timeA = a.bookingDetails?.startTime || a.startTime;
            const dateB = b.bookingDetails?.date || b.date;
            const timeB = b.bookingDetails?.startTime || b.startTime;
            return new Date(`${dateA} ${timeA}`) - new Date(`${dateB} ${timeB}`);
        });
        bookings.forEach(booking => {
            // Usar a estrutura correta dos dados
            const buildingId = booking.locationDetails?.buildingId || booking.buildingId;
            const floorId = booking.locationDetails?.floorId || booking.floorId;
            const deskId = booking.locationDetails?.deskId || booking.deskId;
            const date = booking.bookingDetails?.date || booking.date;
            const startTime = booking.bookingDetails?.startTime || booking.startTime;
            const endTime = booking.bookingDetails?.endTime || booking.endTime;
            
            const buildingName = state.liveBuildingsData[buildingId]?.name || 'Edifício Removido';
            const floorName = state.liveBuildingsData[buildingId]?.floors[floorId]?.name || 'Andar Removido';
            
            const item = document.createElement('div');
            item.className = 'my-booking-item flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 card-modern rounded-xl';
            item.innerHTML = `<div><p class="font-medium text-white">${booking.deskId} (${buildingName}, ${floorName})</p><p class="text-sm text-gray-300">${booking.date} das ${booking.startTime} às ${booking.endTime}</p></div><button class="cancel-button mt-2 sm:mt-0 bg-gradient-warning text-white px-3 py-1 rounded-xl text-sm font-medium hover:shadow-lg btn-modern" data-booking-id="${booking.id}">Cancelar</button>`;
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


const toggleAdminView = (isAdmin) => {
    state.isAdminView = isAdmin;
    if (isAdmin) {
        hide(ui.admin.userView);
        show(ui.admin.adminView);
        ui.admin.appTitle.textContent = 'Dashboard Admin';
        ui.admin.toggleAdminViewBtn.textContent = 'Fazer Reserva';
        // Mostrar dashboard por padrão
        ui.adminDashboard.classList.remove('hidden');
        ui.spaceManager.classList.add('hidden');
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
        
        // Notificação de cancelamento
        if (state.notificationSettings.cancellation) {
            createNotification('warning', 'Reserva Cancelada', 'A sua reserva foi cancelada com sucesso.');
        }
    } catch (error) {
        displayMessage("Erro ao cancelar a reserva.", "error");
        
        // Notificação de erro
        if (state.notificationSettings.system) {
            createNotification('error', 'Erro ao Cancelar', 'Não foi possível cancelar a reserva. Tente novamente.');
        }
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
    
    // Inicializar sistema de notificações
    loadNotificationSettings();
    loadNotificationHistory();
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
    
    // ===== BOTÕES DE NAVEGAÇÃO - EVENT LISTENERS =====
    
    // Voltar para seleção de mesas
    ui.backToDesks.addEventListener('click', () => {
        document.getElementById('booking-details-summary').classList.add('hidden');
        goToStep(3);
    });
    
    // Voltar para nova reserva (do dashboard)
    ui.backToBooking.addEventListener('click', () => {
        goToStep(1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // Voltar para vista de utilizador (do admin)
    ui.backToUserView.addEventListener('click', () => {
        toggleAdminView(false);
    });
    
    // Voltar para dashboard admin (do gestor de espaços)
    ui.backToAdminDashboard.addEventListener('click', () => {
        toggleAdminSpaceManager(false);
    });
    
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
                
                // Notificação de reserva confirmada
                if (state.notificationSettings.booking) {
                    createNotification('success', 'Reserva Confirmada', `A sua reserva para ${state.selectedDeskId} foi confirmada com sucesso!`);
                }
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

    // ===== SISTEMA DE NOTIFICAÇÕES - EVENT LISTENERS =====
    
    // Botão de configurações de notificação
    ui.notificationSettingsBtn.addEventListener('click', () => {
        showNotificationSettings();
    });
    
    // Botão de histórico de notificações
    ui.notificationHistoryBtn.addEventListener('click', () => {
        showNotificationHistory();
    });
    
    // Salvar configurações de notificação
    ui.saveNotificationSettings.addEventListener('click', () => {
        state.notificationSettings.booking = ui.bookingNotifications.checked;
        state.notificationSettings.cancellation = ui.cancellationNotifications.checked;
        state.notificationSettings.system = ui.systemNotifications.checked;
        state.notificationSettings.sound = ui.notificationSound.checked;
        
        saveNotificationSettings();
        hideModalWithAnimation(ui.notificationSettingsModal, ui.notificationSettingsContent);
        
        createNotification('success', 'Configurações Salvas', 'As suas configurações de notificação foram atualizadas.');
    });
    
    // Cancelar configurações de notificação
    ui.cancelNotificationSettings.addEventListener('click', () => {
        hideModalWithAnimation(ui.notificationSettingsModal, ui.notificationSettingsContent);
    });
    
    // Fechar histórico de notificações
    ui.closeNotificationHistory.addEventListener('click', () => {
        hideModalWithAnimation(ui.notificationHistoryModal, ui.notificationHistoryContent);
    });

    // ===== SISTEMA DE EXPORTAÇÃO - EVENT LISTENERS =====
    
    // Botão de exportação avançada
    ui.advancedExportBtn.addEventListener('click', () => {
        showExportModal();
    });
    
    // Fechar modal de exportação
    ui.closeExportModal.addEventListener('click', () => {
        hideModalWithAnimation(ui.exportModal, ui.exportModalContent);
    });
    
    // Exportar para Excel
    ui.exportExcelBtn.addEventListener('click', async () => {
        try {
            const startDate = ui.exportStartDate.value;
            const endDate = ui.exportEndDate.value;
            const data = await fetchFilteredData(startDate, endDate);
            
            if (data.length === 0) {
                createNotification('warning', 'Sem Dados', 'Não há dados para exportar no período selecionado.');
                return;
            }
            
            await exportToExcel(data, 'reservas_excel');
            hideModalWithAnimation(ui.exportModal, ui.exportModalContent);
        } catch (error) {
            console.error('Erro ao exportar para Excel:', error);
            createNotification('error', 'Erro na Exportação', 'Não foi possível exportar os dados.');
        }
    });
    
    // Exportar backup JSON
    ui.exportJsonBtn.addEventListener('click', async () => {
        try {
            const startDate = ui.exportStartDate.value;
            const endDate = ui.exportEndDate.value;
            const data = await fetchFilteredData(startDate, endDate);
            
            if (data.length === 0) {
                createNotification('warning', 'Sem Dados', 'Não há dados para exportar no período selecionado.');
                return;
            }
            
            await exportToJSON(data, 'backup_reservas');
            hideModalWithAnimation(ui.exportModal, ui.exportModalContent);
        } catch (error) {
            console.error('Erro ao exportar backup JSON:', error);
            createNotification('error', 'Erro no Backup', 'Não foi possível criar o backup.');
        }
    });
    
    // Gerar relatório PDF
    ui.exportPdfBtn.addEventListener('click', async () => {
        try {
            const startDate = ui.exportStartDate.value;
            const endDate = ui.exportEndDate.value;
            const data = await fetchFilteredData(startDate, endDate);
            
            if (data.length === 0) {
                createNotification('warning', 'Sem Dados', 'Não há dados para exportar no período selecionado.');
                return;
            }
            
            const options = {
                title: `Relatório de Reservas - ${startDate} a ${endDate}`,
                includeStats: ui.includeStats.checked,
                includeCharts: ui.includeCharts.checked,
                includeUsers: ui.includeUsers.checked
            };
            
            await generatePDFReport(data, options);
            hideModalWithAnimation(ui.exportModal, ui.exportModalContent);
        } catch (error) {
            console.error('Erro ao gerar PDF:', error);
            createNotification('error', 'Erro no PDF', 'Não foi possível gerar o relatório PDF.');
        }
    });
    
    // Relatório personalizado
    ui.exportCustomBtn.addEventListener('click', () => {
        hideModalWithAnimation(ui.exportModal, ui.exportModalContent);
        showCustomReportModal();
    });
    
    // Gerar relatório personalizado
    ui.generateCustomReport.addEventListener('click', async () => {
        try {
            const title = ui.customReportTitle.value || 'Relatório Personalizado';
            const description = ui.customReportDescription.value || '';
            const startDate = ui.exportStartDate.value;
            const endDate = ui.exportEndDate.value;
            
            const data = await fetchFilteredData(startDate, endDate);
            
            if (data.length === 0) {
                createNotification('warning', 'Sem Dados', 'Não há dados para exportar no período selecionado.');
                return;
            }
            
            const options = {
                title: title,
                description: description,
                includeStats: ui.sectionSummary.checked,
                includeCharts: false,
                includeUsers: ui.sectionUsers.checked
            };
            
            await generatePDFReport(data, options);
            hideModalWithAnimation(ui.customReportModal, ui.customReportContent);
        } catch (error) {
            console.error('Erro ao gerar relatório personalizado:', error);
            createNotification('error', 'Erro no Relatório', 'Não foi possível gerar o relatório personalizado.');
        }
    });
    
    // Cancelar relatório personalizado
    ui.cancelCustomReport.addEventListener('click', () => {
        hideModalWithAnimation(ui.customReportModal, ui.customReportContent);
    });

    // ===== DASHBOARD DO ADMINISTRADOR - EVENT LISTENERS =====
    
    // Botão de gerir espaços
    ui.manageSpacesBtn.addEventListener('click', () => {
        toggleAdminSpaceManager(true);
    });
    
    // Botão de ver relatórios
    ui.viewReportsBtn.addEventListener('click', () => {
        // TODO: Implementar sistema de relatórios
        alert('Sistema de relatórios em desenvolvimento');
    });
    
    // Botão de exportar dados administrativos
    ui.exportAdminDataBtn.addEventListener('click', async () => {
        try {
            // Buscar todas as reservas
            const bookingsRef = collection(db, `/artifacts/${appId}/public/data/bookings`);
            const snapshot = await getDocs(bookingsRef);
            const allBookings = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
            
            // Preparar dados para exportação
            const exportData = allBookings.map(booking => ({
                'ID': booking.id,
                'Data': booking.bookingDetails?.date || booking.date,
                'Hora Início': booking.bookingDetails?.startTime || booking.startTime,
                'Hora Fim': booking.bookingDetails?.endTime || booking.endTime,
                'Utilizador': booking.userDetails?.email || booking.userEmail || 'N/A',
                'Edifício': state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.name || 'N/A',
                'Andar': state.liveBuildingsData[booking.locationDetails?.buildingId || booking.buildingId]?.floors[booking.locationDetails?.floorId || booking.floorId]?.name || 'N/A',
                'Mesa': booking.locationDetails?.deskId || booking.deskId,
                'Status': booking.status || 'Ativa',
                'Data de Criação': booking.createdAt || 'N/A'
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
            link.setAttribute('download', `relatorio_admin_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Mostrar mensagem de sucesso
            showSuccessModal('Relatório exportado com sucesso!');
            
        } catch (error) {
            console.error('Erro ao exportar relatório:', error);
            alert('Erro ao exportar relatório. Tente novamente.');
        }
    });
    
    // Botão de configurações do sistema
    ui.systemSettingsBtn.addEventListener('click', () => {
        // TODO: Implementar configurações do sistema
        alert('Configurações do sistema em desenvolvimento');
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