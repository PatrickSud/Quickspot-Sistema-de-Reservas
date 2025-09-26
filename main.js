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
};

// --- UTILITY ---
const isTimeOverlap = (start1, end1, start2, end2) => start1 < end2 && start2 < end1;
const getTodayDateString = () => new Date().toISOString().split('T')[0];

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
    hide(document.getElementById('step-1'));
    hide(document.getElementById('step-2'));
    hide(document.getElementById('step-3'));
    hide(ui.bookingDetailsSummary);
    show(document.getElementById(`step-${step}`));
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
    ui.desksContainer.innerHTML = '';
    const desks = state.liveBuildingsData[state.selectedBuildingId].floors[state.selectedFloorId].desks;
    desks.forEach(deskId => {
        const card = document.createElement('div');
        const isAvailable = !deskBookings.some(b => b.deskId === deskId);
        const isSelected = state.selectedDeskId === deskId;
        card.className = `card p-4 rounded-xl shadow-md text-center cursor-pointer transition-all ${isAvailable ? 'bg-gray-700 text-blue-300 hover:bg-gray-600' : 'bg-gray-900 text-gray-500 cursor-not-allowed'} ${isSelected ? 'ring-4 ring-blue-500' : ''}`;
        card.innerHTML = `<h3 class="font-semibold text-lg">${deskId}</h3><p class="text-sm mt-1">${isAvailable ? 'Disponível' : 'Ocupado'}</p>`;
        if (isAvailable) {
            card.addEventListener('click', () => {
                state.selectedDeskId = deskId;
                updateBookingDetails();
                hide(document.getElementById('step-3'));
                show(ui.bookingDetailsSummary);
                document.querySelectorAll('.card').forEach(c => c.classList.remove('ring-4', 'ring-blue-500'));
                card.classList.add('ring-4', 'ring-blue-500');
            });
        }
        ui.desksContainer.appendChild(card);
    });
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
            item.className = 'my-booking-item flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-gray-700 rounded-xl shadow';
            item.innerHTML = `<div><p class="font-medium text-white">${booking.deskId} (${buildingName}, ${floorName})</p><p class="text-sm text-gray-300">${booking.date} das ${booking.startTime} às ${booking.endTime}</p></div><button class="cancel-button mt-2 sm:mt-0 bg-red-800 text-red-200 px-3 py-1 rounded-full text-sm font-medium hover:bg-red-700" data-booking-id="${booking.id}">Cancelar</button>`;
            ui.myBookingsList.appendChild(item);
        });
        document.querySelectorAll('.cancel-button').forEach(button => button.addEventListener('click', e => cancelBooking(e.target.dataset.bookingId)));
    }
};

// --- ADMIN DASHBOARD ---
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

const renderLayoutManager = () => {
    const manager = ui.admin.layoutManager;
    manager.innerHTML = ''; // Limpa a vista para renderizar de novo

    if (Object.keys(state.liveBuildingsData).length === 0) {
        manager.innerHTML = '<p class="text-center text-gray-500">Nenhum edifício criado. Adicione o primeiro!</p>';
    }

    // Itera sobre os edifícios
    for (const buildingId in state.liveBuildingsData) {
        const building = state.liveBuildingsData[buildingId];
        const buildingEl = document.createElement('div');
        buildingEl.className = 'bg-gray-800 p-4 rounded-lg';
        buildingEl.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <h4 class="text-lg font-bold text-white">${building.name}</h4>
                <button class="remove-building-btn text-red-400 hover:text-red-300 text-sm font-bold" data-building-id="${buildingId}">Remover</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-700 space-y-2" data-floors-container-for="${buildingId}">
                </div>
            <button class="add-floor-btn mt-3 text-sm bg-blue-800 text-white py-1 px-3 rounded hover:bg-blue-700" data-building-id="${buildingId}">Adicionar Andar</button>
        `;

        const floorsContainer = buildingEl.querySelector(`[data-floors-container-for="${buildingId}"]`);

        // Itera sobre os andares do edifício
        for (const floorId in building.floors) {
            const floor = building.floors[floorId];
            const floorEl = document.createElement('div');
            floorEl.className = 'bg-gray-700 p-3 rounded-md';
            floorEl.innerHTML = `
                <div class="flex justify-between items-center mb-2">
                    <p class="font-semibold text-gray-200">${floor.name}</p>
                    <button class="remove-floor-btn text-red-500 hover:text-red-400 text-xs font-bold" data-building-id="${buildingId}" data-floor-id="${floorId}">Remover</button>
                </div>
                <div class="flex flex-wrap gap-2" data-desks-container-for="${floorId}">
                    </div>
                <button class="add-desk-btn mt-2 text-xs bg-indigo-800 text-white py-1 px-2 rounded hover:bg-indigo-700" data-building-id="${buildingId}" data-floor-id="${floorId}">Adicionar Mesa</button>
            `;

            const desksContainer = floorEl.querySelector(`[data-desks-container-for="${floorId}"]`);
            
            // Itera sobre as mesas do andar
            floor.desks.forEach(deskId => {
                const deskEl = document.createElement('div');
                deskEl.className = 'bg-gray-600 px-2 py-1 rounded-full text-xs flex items-center gap-2';
                deskEl.innerHTML = `
                    <span>${deskId}</span>
                    <button class="remove-desk-btn text-gray-300 hover:text-white" data-building-id="${buildingId}" data-floor-id="${floorId}" data-desk-id="${deskId}">&times;</button>
                `;
                desksContainer.appendChild(deskEl);
            });
            floorsContainer.appendChild(floorEl);
        }
        manager.appendChild(buildingEl);
    }
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

const saveLayout = async () => {
    try {
        // Usa o estado atual do objeto `liveBuildingsData` para guardar
        await setDoc(doc(db, `/artifacts/${appId}/public/data/layout/main`), { 
            structure: JSON.stringify(state.liveBuildingsData) 
        });
        displayMessage("Estrutura guardada com sucesso!");
    } catch (error) {
        console.error("Erro ao guardar a estrutura:", error);
        displayMessage("Ocorreu um erro ao guardar a estrutura.", "error");
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

        // Estrutura de dados mais organizada
        const bookingData = {
            // Detalhes do utilizador que fez a reserva
            userDetails: {
                email: state.currentUser.email,
                uid: state.currentUser.uid
            },
            // Detalhes da reserva
            bookingDetails: {
                date: state.selectedDate,
                startTime: state.selectedStartTime,
                endTime: state.selectedEndTime,
            },
            // Detalhes da localização
            locationDetails: {
                buildingId: state.selectedBuildingId,
                floorId: state.selectedFloorId,
                deskId: state.selectedDeskId
            },
            // Timestamp para saber quando a reserva foi criada
            createdAt: serverTimestamp()
        };

        try {
            // Usamos addDoc para que o Firestore gere um ID único automaticamente
            const bookingsCollection = collection(db, `/artifacts/${appId}/public/data/bookings`);
            await addDoc(bookingsCollection, bookingData);

            displayMessage("Reserva confirmada com sucesso!");
            initializeAppUI(); // Reseta a UI para o estado inicial

        } catch (e) {
            console.error("Erro ao fazer a reserva: ", e);
            displayMessage("Ocorreu um erro ao tentar fazer a reserva.", "error");
        }
    });

    // --- Admin Listeners ---
    ui.admin.toggleAdminViewBtn.addEventListener('click', () => {
        toggleAdminView(!state.isAdminView);
    });

    // Botão para guardar a estrutura
    ui.admin.saveBtn.addEventListener('click', saveLayout);

    // Botão principal para adicionar um novo edifício
    ui.admin.addBuildingBtn.addEventListener('click', () => {
        const buildingName = prompt("Qual é o nome do novo edifício?");
        if (buildingName) {
            // Cria um ID simples (pode ser melhorado com um gerador de UUIDs)
            const buildingId = `building-${Date.now()}`;
            state.liveBuildingsData[buildingId] = {
                name: buildingName,
                floors: {}
            };
            renderLayoutManager(); // Re-renderiza a UI com o novo edifício
        }
    });

    // Listener delegado para os botões dentro do gestor
    ui.admin.layoutManager.addEventListener('click', (e) => {
        const target = e.target;
        const { buildingId, floorId, deskId } = target.dataset;

        // Adicionar Andar
        if (target.classList.contains('add-floor-btn')) {
            const floorName = prompt(`Qual o nome do novo andar para o edifício "${state.liveBuildingsData[buildingId].name}"?`);
            if (floorName) {
                const floorId = `floor-${Date.now()}`;
                state.liveBuildingsData[buildingId].floors[floorId] = {
                    name: floorName,
                    desks: []
                };
                renderLayoutManager();
            }
        }

        // Adicionar Mesa
        if (target.classList.contains('add-desk-btn')) {
            const newDeskId = prompt(`Qual o nome/código da nova mesa? (ex: A1-05)`);
            if (newDeskId) {
                state.liveBuildingsData[buildingId].floors[floorId].desks.push(newDeskId);
                renderLayoutManager();
            }
        }
        
        // Remover Edifício
        if (target.classList.contains('remove-building-btn')) {
            if (confirm(`Tem a certeza que quer remover o edifício "${state.liveBuildingsData[buildingId].name}" e todos os seus andares e mesas?`)) {
                delete state.liveBuildingsData[buildingId];
                renderLayoutManager();
            }
        }
        
        // Remover Andar
        if (target.classList.contains('remove-floor-btn')) {
            if (confirm(`Tem a certeza que quer remover o andar "${state.liveBuildingsData[buildingId].floors[floorId].name}"?`)) {
                delete state.liveBuildingsData[buildingId].floors[floorId];
                renderLayoutManager();
            }
        }
        
        // Remover Mesa
        if (target.classList.contains('remove-desk-btn')) {
            // Não precisa de confirmação para algo tão pequeno, mas pode adicionar se quiser
            const desks = state.liveBuildingsData[buildingId].floors[floorId].desks;
            const deskIndex = desks.indexOf(deskId);
            if (deskIndex > -1) {
                desks.splice(deskIndex, 1);
            }
            renderLayoutManager();
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