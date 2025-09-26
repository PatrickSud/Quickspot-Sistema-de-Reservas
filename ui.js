export const ui = {
    authSection: document.getElementById('auth-section'),
    appSection: document.getElementById('app-section'),
    loadingSpinner: document.getElementById('loading-spinner'),
    emailInput: document.getElementById('email-input'),
    passwordInput: document.getElementById('password-input'),
    loginButton: document.getElementById('login-button'),
    signupButton: document.getElementById('signup-button'),
    logoutButton: document.getElementById('logout-button'),
    dateInput: document.getElementById('date-input'),
    buildingSelect: document.getElementById('building-select'),
    floorSelect: document.getElementById('floor-select'),
    startTimeSelect: document.getElementById('start-time-select'),
    endTimeSelect: document.getElementById('end-time-select'),
    desksContainer: document.getElementById('desks-container'),
    bookButton: document.getElementById('book-button'),
    myBookingsList: document.getElementById('my-bookings-list'),
    messageBox: document.getElementById('message-box'),
    configErrorBox: document.getElementById('config-error-box'),
    nextToFloorBtn: document.getElementById('next-to-floor'),
    nextToDesksBtn: document.getElementById('next-to-desks'),
    backToBuildingBtn: document.getElementById('back-to-building'),
    backToFloorBtn: document.getElementById('back-to-floor'),
    selectedUserDisplay: document.getElementById('selected-user'),
    selectedDateDisplay: document.getElementById('selected-date-display'),
    selectedTimeDisplay: document.getElementById('selected-time-display'),
    selectedBuildingDisplay: document.getElementById('selected-building-display'),
    selectedFloorDisplay: document.getElementById('selected-floor-display'),
    selectedDeskDisplay: document.getElementById('selected-desk-display'),
    bookingDetailsSummary: document.getElementById('booking-details-summary'),
    fillAdminBtn: document.getElementById('fill-admin-btn'),
    fillUserBtn: document.getElementById('fill-user-btn'),
    // Filtros
    tagFilter: document.getElementById('tag-filter'),
    statusFilter: document.getElementById('status-filter'),
    searchFilter: document.getElementById('search-filter'),
    clearFiltersBtn: document.getElementById('clear-filters'),
    // Reservas recorrentes
    recurringBooking: document.getElementById('recurring-booking'),
    recurringOptions: document.getElementById('recurring-options'),
    recurringFrequency: document.getElementById('recurring-frequency'),
    recurringEndDate: document.getElementById('recurring-end-date'),
    // Modais
    successModal: document.getElementById('success-modal'),
    successModalContent: document.getElementById('success-modal-content'),
    successMessage: document.getElementById('success-message'),
    genericModalContent: document.getElementById('generic-modal-content'),
    // Dashboard do Utilizador
    userDashboard: document.getElementById('user-dashboard'),
    monthlyBookings: document.getElementById('monthly-bookings'),
    totalHours: document.getElementById('total-hours'),
    favoriteDesk: document.getElementById('favorite-desk'),
    usageFrequency: document.getElementById('usage-frequency'),
    weeklyChart: document.getElementById('weekly-chart'),
    floorDistribution: document.getElementById('floor-distribution'),
    upcomingBookings: document.getElementById('upcoming-bookings'),
    favoriteDesks: document.getElementById('favorite-desks'),
    quickBookBtn: document.getElementById('quick-book-btn'),
    viewHistoryBtn: document.getElementById('view-history-btn'),
    exportDataBtn: document.getElementById('export-data-btn'),
    // Dashboard do Administrador
    adminDashboard: document.getElementById('admin-dashboard'),
    spaceManager: document.getElementById('space-manager'),
    totalBookings: document.getElementById('total-bookings'),
    activeUsers: document.getElementById('active-users'),
    occupancyRate: document.getElementById('occupancy-rate'),
    availableDesks: document.getElementById('available-desks'),
    dailyBookingsChart: document.getElementById('daily-bookings-chart'),
    buildingDistribution: document.getElementById('building-distribution'),
    topUsers: document.getElementById('top-users'),
    recentBookings: document.getElementById('recent-bookings'),
    manageSpacesBtn: document.getElementById('manage-spaces-btn'),
    viewReportsBtn: document.getElementById('view-reports-btn'),
    exportAdminDataBtn: document.getElementById('export-admin-data-btn'),
    systemSettingsBtn: document.getElementById('system-settings-btn'),
    admin: {
        manageBtn: document.getElementById('manage-layout-btn'),
        editor: document.getElementById('layout-json-editor'),
        saveBtn: document.getElementById('save-layout-btn'),
        addBuildingBtn: document.getElementById('add-building-btn'),
        cancelBtn: document.getElementById('cancel-layout-btn'),
        toggleAdminViewBtn: document.getElementById('toggle-admin-view-btn'),
        adminView: document.getElementById('admin-view'),
        userView: document.getElementById('user-view'),
        appTitle: document.getElementById('app-title'),
        occupancyRate: document.getElementById('occupancy-rate'),
        popularBuilding: document.getElementById('popular-building'),
        totalBookingsToday: document.getElementById('total-bookings-today'),
        allBookingsList: document.getElementById('all-bookings-list'),
        layoutManager: document.getElementById('layout-manager'),
        modal: {
            container: document.getElementById('generic-modal'),
            title: document.getElementById('modal-title'),
            content: document.getElementById('modal-content'),
            saveBtn: document.getElementById('modal-save-btn'),
            cancelBtn: document.getElementById('modal-cancel-btn'),
        }
    }
};

export const show = (el) => el.classList.remove('hidden');
export const hide = (el) => el.classList.add('hidden');

export const displayMessage = (message, type = 'success') => {
    ui.messageBox.textContent = message;
    ui.messageBox.className = `mt-4 p-4 rounded-xl text-center`;
    ui.messageBox.classList.add(type === 'success' ? 'bg-green-800' : 'bg-red-800', type === 'success' ? 'text-green-200' : 'text-red-200');
    show(ui.messageBox);
    setTimeout(() => hide(ui.messageBox), 5000);
};

export const populateSelect = (select, options, placeholder) => {
    select.innerHTML = `<option value="">${placeholder}</option>`;
    options.forEach(opt => select.innerHTML += `<option value="${opt.id || opt}">${opt.name || opt}</option>`);
};