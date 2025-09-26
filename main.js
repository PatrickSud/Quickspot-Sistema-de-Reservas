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
    ui.admin.layoutManager.innerHTML = '';
    for (const buildingId in state.liveBuildingsData) {
        const building = state.liveBuildingsData[buildingId];
        const buildingEl = document.createElement('div');
        buildingEl.className = 'p-4 bg-gray-800 rounded-lg mb-4';
        buildingEl.innerHTML = `<h4 class="text-lg font-bold text-white">${building.name}</h4>`;
        // Adicionar andares e mesas
        // (Interface de gestão mais complexa pode ser adicionada aqui)
        ui.admin.layoutManager.appendChild(buildingEl);
    }
    // Nota: A gestão completa (add/remove) é complexa e excede um snippet simples.
    // Por agora, substituímos o JSON por uma visualização. A edição ainda é recomendada via `saveLayout` com JSON.
    ui.admin.layoutManager.innerHTML += `<p class="text-center text-sm text-gray-400 mt-4">A gestão visual completa será implementada numa futura versão. Por agora, pode continuar a editar a estrutura via JSON no modal.</p>`;
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
        const newLayoutStr = ui.admin.editor.value;
        const newLayout = JSON.parse(newLayoutStr); // Validate JSON
        await setDoc(doc(db, `/artifacts/${appId}/public/data/layout/main`), { structure: newLayoutStr });
        state.liveBuildingsData = newLayout;
        initializeAppUI();
        hide(ui.admin.modal);
        displayMessage("Estrutura guardada com sucesso!");
    } catch (error) {
        displayMessage("Erro: JSON inválido. Verifique o texto e tente novamente.", "error");
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

    // Admin
    ui.admin.toggleAdminViewBtn.addEventListener('click', () => {
        toggleAdminView(!state.isAdminView);
    });
    // O modal antigo pode ser removido ou mantido como fallback
    // ui.admin.manageBtn.addEventListener('click', () => { ui.admin.editor.value = JSON.stringify(state.liveBuildingsData, null, 2); show(ui.admin.modal); });
    // ui.admin.cancelBtn.addEventListener('click', () => hide(ui.admin.modal));
    // ui.admin.saveBtn.addEventListener('click', saveLayout);
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