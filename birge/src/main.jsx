import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n' // Инициализация i18next
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initSentry } from './sentry'
import './index.css'

initSentry()

// Новый service worker забирает контроль сразу (skipWaiting + clientsClaim).
// Один перезапуск переключает уже открытую вкладку на свежий бандл.
if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller)
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshing) return
        refreshing = true
        window.location.reload()
    })
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </BrowserRouter>
    </React.StrictMode>,
)
