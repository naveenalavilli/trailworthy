// Local persistence. Nothing here syncs anywhere; closing the tab mid-trail
// must not lose a survey, and that is the whole requirement.

const DB_NAME = 'trailworthy';
const DB_VERSION = 1;

// One connection for the life of the page, rather than a new one per call that
// is never closed.
let connection = null;

function open() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('surveys')) {
        db.createObjectStore('surveys', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('surveyId', 'surveyId');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Let a newer version of the app in another tab upgrade the schema.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      connection = null;
      reject(request.error);
    };
  });
  return connection;
}

async function tx(store, mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const result = run(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export const putSurvey = (survey) => tx('surveys', 'readwrite', (s) => s.put(survey));
export const getSurvey = (id) => tx('surveys', 'readonly', (s) => s.get(id));
export const allSurveys = () => tx('surveys', 'readonly', (s) => s.getAll());
export const putNote = (note) => tx('notes', 'readwrite', (s) => s.put(note));

export async function notesFor(surveyId) {
  const notes = await tx('notes', 'readonly', (s) => s.index('surveyId').getAll(surveyId));
  return (notes ?? []).sort((a, b) => a.at - b.at);
}

export async function deleteSurvey(id) {
  const notes = await notesFor(id);
  await tx('notes', 'readwrite', (store) => {
    notes.forEach((note) => store.delete(note.id));
  });
  return tx('surveys', 'readwrite', (s) => s.delete(id));
}
