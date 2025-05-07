// Service Worker для перехвата и анализа сетевых запросов
let isLogging = false;
const TRACKED_DOMAINS = ['gifts2.tonnel.network']; // Домены, которые нужно отслеживать специально

// Активация Service Worker
self.addEventListener('activate', event => {
  console.log('Service Worker активирован');
  // Захватить управление всеми клиентами
  event.waitUntil(clients.claim());
});

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Service Worker установлен');
  // Перейти к активации, не дожидаясь закрытия старых вкладок
  self.skipWaiting();
});

// Обработка сообщений от основного скрипта
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'START_LOGGING') {
    isLogging = true;
    console.log('Логирование запросов запущено');
  } else if (event.data && event.data.type === 'STOP_LOGGING') {
    isLogging = false;
    console.log('Логирование запросов остановлено');
  }
});

// Отправка логов в основное приложение
async function sendLogToClient(logData) {
  try {
    const allClients = await clients.matchAll({
      includeUncontrolled: true,
      type: 'window'
    });

    allClients.forEach(client => {
      client.postMessage({
        type: 'REQUEST_LOG',
        log: logData
      });
    });
  } catch (error) {
    console.error('Ошибка отправки логов клиенту:', error);
  }
}

// Извлечение payload из различных типов запросов
async function extractPayload(request) {
  try {
    const clonedRequest = request.clone();
    
    // Проверяем тип контента
    const contentType = request.headers.get('Content-Type') || '';
    
    if (contentType.includes('application/json')) {
      return await clonedRequest.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await clonedRequest.formData();
      const formDataObj = {};
      for (const [key, value] of formData.entries()) {
        formDataObj[key] = value;
      }
      return formDataObj;
    } else if (contentType.includes('multipart/form-data')) {
      return 'Multipart form data - невозможно отобразить полное содержимое';
    } else if (contentType.includes('text/')) {
      return await clonedRequest.text();
    } else {
      try {
        // Попытка получить тело как текст
        return await clonedRequest.text();
      } catch (e) {
        return 'Неподдерживаемый тип контента';
      }
    }
  } catch (error) {
    console.error('Ошибка при извлечении payload:', error);
    return 'Ошибка при извлечении payload';
  }
}

// Проверяем, нужно ли отслеживать запрос
function shouldTrackRequest(url) {
  // Всегда отслеживаем запросы к указанным доменам
  for (const domain of TRACKED_DOMAINS) {
    if (url.includes(domain)) {
      return true;
    }
  }
  
  // Если мы в режиме отслеживания всех запросов
  return isLogging;
}

// Перехват запросов
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = request.url;
  
  // Проверяем, нужно ли отслеживать этот запрос
  if (!shouldTrackRequest(url)) return;
  
  event.respondWith(
    (async () => {
      // Собираем информацию о заголовках
      const headers = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      
      // Пытаемся извлечь payload
      let payload = null;
      try {
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          payload = await extractPayload(request);
        }
      } catch (e) {
        console.error('Ошибка при извлечении payload:', e);
      }
      
      // Логируем информацию
      const logData = {
        url: request.url,
        method: request.method,
        headers: headers,
        payload: payload,
        timestamp: new Date().toISOString()
      };
      
      // Отправляем лог клиенту
      sendLogToClient(logData);
      
      // Продолжаем обработку запроса как обычно
      try {
        return await fetch(request.clone());
      } catch (error) {
        console.error('Ошибка при выполнении запроса:', error);
        throw error;
      }
    })()
  );
}); 