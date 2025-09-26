export const ADMIN_EMAIL = 'admin@test.com';

export const initialBuildingsData = {
    'building-a': { name: 'Edifício A', floors: {
        'floor-1': { name: 'Andar 1', desks: ['A1-01', 'A1-02', 'A1-03', 'A1-04'] },
        'floor-2': { name: 'Andar 2', desks: ['A2-01', 'A2-02', 'A2-03', 'A2-04'] }
    }},
    'building-b': { name: 'Edifício B', floors: {
        'floor-1': { name: 'Andar 1 (T.I.)', desks: ['B1-01', 'B1-02', 'B1-03'] },
        'floor-2': { name: 'Andar 2 (RH)', desks: ['B2-01', 'B2-02'] }
    }}
};

export const timeOptions = Array.from({length: 21}, (_, i) => {
    const h = 8 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

export const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';