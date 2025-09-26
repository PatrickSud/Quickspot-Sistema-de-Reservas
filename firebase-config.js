import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDfQbItAwblEZR5HZNLZIuyIMSzy6-1hSY",
    authDomain: "quickspot-sistema-de-reservas.firebaseapp.com",
    projectId: "quickspot-sistema-de-reservas",
    storageBucket: "quickspot-sistema-de-reservas.firebasestorage.app",
    messagingSenderId: "231825412883",
    appId: "1:231825412883:web:1d2ea60b41cc155cefc0e6",
    measurementId: "G-SVZ1F7V14Z"
};

setLogLevel('Debug');
const app = initializeApp(firebaseConfig);
console.log("A aplicação está a tentar conectar-se ao projeto Firebase com o ID:", firebaseConfig.projectId);

export const db = getFirestore(app);
export const auth = getAuth(app);