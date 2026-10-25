// Pachote usa el Firebase de Listopic: la misma cuenta sirve en las dos apps
// y un grupo puede enlazarse al chat de un grupo de Listopic.
// No es secreta: lo que protege los datos son las reglas (viven en el repo de Listopic).
export const firebaseConfig = {
  apiKey: "AIzaSyDPEW5zXtvfnD0XtdmXSkMBZrsFdO-tmsg",
  authDomain: "listopic.es",
  projectId: "listopic",
  storageBucket: "listopic.firebasestorage.app",
  messagingSenderId: "851333213702",
  appId: "1:851333213702:web:e8c2f3b1aa098d923d5d87"
};

// Firebase antiguo de Pachote («pachote-78042»). Solo se usa una vez por
// dispositivo, para mudar sus grupos al de Listopic.
export const legacyConfig = {
  apiKey: "AIzaSyCMwiD3DD0-35RaXQ3akI38z6UWpDaRkp8",
  authDomain: "pachote-78042.firebaseapp.com",
  projectId: "pachote-78042",
  storageBucket: "pachote-78042.firebasestorage.app",
  messagingSenderId: "158752849443",
  appId: "1:158752849443:web:7af26532dc415c0bbebb96"
};
