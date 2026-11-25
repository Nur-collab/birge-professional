import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Словари переводов
const resources = {
    ru: {
        translation: {
            // Общие
            "title": "Birge",
            "loading": "Загрузка...",
            "save": "Сохранить",
            "cancel": "Отмена",
            "back": "Назад",
            "copy": "Скопировать",

            // Авторизация
            "auth.login": "Вход",
            "auth.phone_number": "Номер телефона",
            "auth.enter_phone": "Введите номер телефона без +",
            "auth.get_code": "Получить код",
            "auth.sms_code": "Код подтверждения",
            "auth.check_sms": "Мы отправим 6-значный код в Telegram-бот @BirgeAuthBot, если ваш номер уже привязан к боту.",
            "auth.enter_code": "Введите 6-значный код",
            "auth.verify": "Войти",
            "auth.error_invalid_phone": "Введите 9 цифр после +996",
            "auth.error_generic": "Ошибка авторизации",
            "auth.tg_quick_btn": "Войти через @BirgeAuthBot",
            "auth.tg_quick_sub": "Без ожидания 6-значного кода — подтвердите номер в Telegram",
            "auth.prereq_title": "Важно перед получением кода",
            "auth.prereq_desc": "Обычные SMS не отправляются. Если вы здесь впервые, сначала отправьте свой номер боту @BirgeAuthBot — иначе код не придёт.",
            "auth.open_bot": "Открыть @BirgeAuthBot",
            "auth.resend_in": "Отправить код повторно через {{seconds}} сек",
            "auth.resend_now": "Отправить код повторно",
            "auth.rescue_title": "Код не приходит?",
            "auth.rescue_desc": "Скорее всего, вы ещё не отправили свой номер в @BirgeAuthBot или указали другой номер.",

            // Навигация / Таббар
            "nav.find": "Поиск",
            "nav.create": "Создать",
            "nav.profile": "Профиль",
            "nav.on_way": "В пути",
            "nav.trips": "Поездки",

            // Главный экран (Dashboard)
            "dash.greeting": "Привет, {{name}}",
            "dash.where_to": "Куда поедем сегодня?",
            "dash.find_ride": "Найти поездку",
            "dash.offer_ride": "Предложить поездку",
            "dash.your_location": "Вы здесь",
            "dash.unknown_location": "Ищем вас...",

            // Быстрые теги (Бишкек)
            "tags.title": "Популярные направления",
            "tags.hint": "Нажмите, чтобы быстро выбрать:",
            "tags.target_from": "Откуда",
            "tags.target_to": "Куда",

            // Поиск и Фильтры
            "search.from": "Откуда",
            "search.to": "Куда",
            "search.date": "Дата поездки",
            "search.search_btn": "Найти",
            "search.creating_ride": "Создание поездки...",
            "search.create_btn": "Создать",

            // Совпадения (Matches)
            "matches.title": "Попутчики",
            "matches.empty": "Пока нет подходящих поездок",
            "matches.searching": "Ищем совпадения...",
            "matches.trip": "Поездка",
            "matches.price": "Цена",
            "matches.seats": "Мест",
            "matches.driver": "Водитель",
            "matches.passenger": "Пассажир",
            "matches.open": "Открыть чат",
            "matches.status.active": "В процессе",
            "matches.status.completed": "Завершено",

            // Детали поездки и Чат (Trip / Chat)
            "trip.title": "Поездка",
            "trip.details": "Детали",
            "trip.car": "Автомобиль: {{model}} ({{color}})",
            "trip.plate": "Гос. номер: {{plate}}",
            "trip.chat": "Чат",
            "trip.type_message": "Сообщение...",
            "trip.send": "Отправить",

            // Оплата и компенсация расходов (MBank / Элкарт)
            "payment.title": "Разделить расходы",
            "payment.driver_requisites": "Реквизиты водителя",
            "payment.mbank_btn": "Оплатить через MBank",
            "payment.elkart_card": "Карта Элкарт",
            "payment.copied": "Реквизиты скопированы",
            "payment.open_mbank": "Перейти в MBank",
            "payment.per_seat": "за место",
            "payment.not_specified": "Водитель не заполнил реквизиты",

            // Запланированные поездки
            "sched.title": "Запланированные",
            "sched.empty": "Нет запланированных поездок",
            "sched.upcoming": "предстоящих поездок",
            "sched.cancel": "Отменить поездку",

            // Профиль и Настройки
            "profile.title": "Мой Профиль",
            "profile.history": "История поездок",
            "profile.settings": "Настройки",
            "profile.logout": "Выйти",
            "profile.rating": "Рейтинг",
            "profile.reviews": "Отзывов",
            "profile.since": "С нами",
            "profile.trips_today": "Поездок водителем (сегодня)",
            "profile.trips_hint": "Ради безопасности мы ограничиваем поездки для предотвращения коммерческого извоза.",
            "profile.reviews_title": "Отзывы от попутчиков",
            "profile.no_reviews": "Пока нет отзывов",
            "profile.legal": "Правовая информация (КР)",

            "settings.title": "Настройки",
            "settings.language": "Язык приложения",
            "settings.personal": "Личные данные",
            "settings.name": "Имя",
            "settings.photo_url": "URL Фотографии",
            "settings.driver_info": "Данные автомобиля (если вы водитель)",
            "settings.car_model": "Марка авто",
            "settings.car_color": "Цвет авто",
            "settings.car_plate": "Гос. номер",
            "settings.payment_info": "Реквизиты для компенсации расходов",
            "settings.mbank_phone": "Номер для MBank (например, 0555123456)",
            "settings.elkart_number": "Номер карты Элкарт (16 цифр)",
            "settings.saved_success": "Настройки сохранены!",

            // Правовые документы
            "legal.terms": "Правила использования",
            "legal.privacy": "Политика конфиденциальности",
            "legal.law_kg": "Согласно Закону КР «Об информации персонального характера»",

            // История поездок
            "history.title": "История поездок",
            "history.empty": "Пока нет поездок",

            // Отзывы
            "review.title": "Оцените поездку",
            "review.how_was_trip": "Как прошла поездка?",
            "review.placeholder": "Оставьте комментарий (необязательно)...",
            "review.skip": "Пропустить",
            "review.submit": "Отправить",
            "review.thanks": "Спасибо за отзыв!",
            "review.community": "Вы помогаете сообществу становиться лучше",
            "review.rating.0": "",
            "review.terrible": "Ужасно",
            "review.bad": "Плохо",
            "review.ok": "Нормально",
            "review.good": "Хорошо",
            "review.great": "Отлично"
        }
    },
    ky: {
        translation: {
            // Общие
            "title": "Бирге",
            "loading": "Жүктөлүүдө...",
            "save": "Сактоо",
            "cancel": "Жокко чыгаруу",
            "back": "Артка",
            "copy": "Көчүрүү",

            // Авторизация
            "auth.login": "Кирүү",
            "auth.phone_number": "Телефон номери",
            "auth.enter_phone": "Номерди + жок киргизиңиз",
            "auth.get_code": "Кодду алуу",
            "auth.sms_code": "Ырастоо коду",
            "auth.check_sms": "Номериңиз ботко байланган болсо, 6 орундуу код @BirgeAuthBot Telegram-ботуна келет.",
            "auth.enter_code": "6 орундуу кодду киргизиңиз",
            "auth.verify": "Кирүү",
            "auth.error_invalid_phone": "+996дан кийин 9 санды киргизиңиз",
            "auth.error_generic": "Авторизация катасы",
            "auth.tg_quick_btn": "@BirgeAuthBot аркылуу кирүү",
            "auth.tg_quick_sub": "6 орундуу кодду күтпөстөн — номерди Telegram аркылуу ырастаңыз",
            "auth.prereq_title": "Код алуудан мурун маанилүү",
            "auth.prereq_desc": "Кадимки SMS жөнөтүлбөйт. Эгер биринчи жолу кирип жатсаңыз, адегенде @BirgeAuthBot ботуна номериңизди жөнөтүңүз — ансыз код келбейт.",
            "auth.open_bot": "@BirgeAuthBot ачуу",
            "auth.resend_in": "Кодду {{seconds}} сек кийин кайра жөнөтүү",
            "auth.resend_now": "Кодду кайра жөнөтүү",
            "auth.rescue_title": "Код келбей жатабы?",
            "auth.rescue_desc": "Адатта @BirgeAuthBot ботуна номериңизди жөнөтө элексиз же башка номер жаздыңыз.",

            // Навигация / Таббар
            "nav.find": "Издөө",
            "nav.create": "Түзүү",
            "nav.profile": "Профиль",
            "nav.on_way": "Жолдо",
            "nav.trips": "Сапарлар",

            // Главный экран (Dashboard)
            "dash.greeting": "Салам, {{name}}",
            "dash.where_to": "Бүгүн кайда барабыз?",
            "dash.find_ride": "Жолдош издөө",
            "dash.offer_ride": "Жолго чыгуу",
            "dash.your_location": "Сиз бул жердесиз",
            "dash.unknown_location": "Сизди издеп жатабыз...",

            // Быстрые теги (Бишкек)
            "tags.title": "Популярдуу багыттар",
            "tags.hint": "Тез тандоо үчүн басыңыз:",
            "tags.target_from": "Кайдан",
            "tags.target_to": "Каякка",

            // Поиск и Фильтры
            "search.from": "Кайдан",
            "search.to": "Каякка",
            "search.date": "Күнү",
            "search.search_btn": "Издөө",
            "search.creating_ride": "Жолго чыгуу түзүлүүдө...",
            "search.create_btn": "Түзүү",

            // Совпадения (Matches)
            "matches.title": "Жолдоштор",
            "matches.empty": "Учурда ылайыктуу сапарлар жок",
            "matches.searching": "Издеп жатабыз...",
            "matches.trip": "Сапар",
            "matches.price": "Баасы",
            "matches.seats": "Орун",
            "matches.driver": "Айдоочу",
            "matches.passenger": "Жүргүнчү",
            "matches.open": "Чатты ачуу",
            "matches.status.active": "Жүрүп жатат",
            "matches.status.completed": "Аяктады",

            // Детали поездки и Чат (Trip / Chat)
            "trip.title": "Сапар",
            "trip.details": "Маалымат",
            "trip.car": "Унаа: {{model}} ({{color}})",
            "trip.plate": "Мам. номер: {{plate}}",
            "trip.chat": "Чат",
            "trip.type_message": "Билдирүү...",
            "trip.send": "Жөнөтүү",

            // Оплата и компенсация расходов (MBank / Элкарт)
            "payment.title": "Чыгымдарды бөлүшүү",
            "payment.driver_requisites": "Айдоочунун реквизиттери",
            "payment.mbank_btn": "MBank аркылуу төлөө",
            "payment.elkart_card": "Элкарт картасы",
            "payment.copied": "Реквизиттер көчүрүлдү",
            "payment.open_mbank": "MBank тиркемесине өтүү",
            "payment.per_seat": "орун үчүн",
            "payment.not_specified": "Айдоочу реквизиттерин жазган эмес",

            // Запланированные поездки
            "sched.title": "Пландалган",
            "sched.empty": "Пландалган сапарлар жок",
            "sched.upcoming": "алдыдагы сапарлар",
            "sched.cancel": "Сапарды токтотуу",

            // Профиль и Настройки
            "profile.title": "Менин профилим",
            "profile.history": "Сапарлар тарыхы",
            "profile.settings": "Жөндөөлөр",
            "profile.logout": "Чыгуу",
            "profile.rating": "Рейтинг",
            "profile.reviews": "Пикирлер",
            "profile.since": "Биз менен",
            "profile.trips_today": "Айдоочу катары сапарлар (бүгүн)",
            "profile.trips_hint": "Коммерциялык такси болбосун деп сапарларды чектейбиз.",
            "profile.reviews_title": "Жолдоштордун пикирлери",
            "profile.no_reviews": "Азырынча пикирлер жок",
            "profile.legal": "Укуктук маалымат (КР)",

            "settings.title": "Ырастоолор",
            "settings.language": "Тиркеме тили",
            "settings.personal": "Жеке маалыматтар",
            "settings.name": "Аты-жөнү",
            "settings.photo_url": "Сүрөт URL",
            "settings.driver_info": "Унаа маалыматы (айдоочу болсоңуз)",
            "settings.car_model": "Унаа маркасы",
            "settings.car_color": "Унаа түсү",
            "settings.car_plate": "Мам. номер",
            "settings.payment_info": "Чыгымдарды кабыл алуу реквизиттери",
            "settings.mbank_phone": "MBank номери (мисалы, 0555123456)",
            "settings.elkart_number": "Элкарт карта номери (16 сан)",
            "settings.saved_success": "Ырастоолор сакталды!",

            // Правовые документы
            "legal.terms": "Колдонуу эрежелери",
            "legal.privacy": "Купуялык саясаты",
            "legal.law_kg": "КР «Жеке мүнөздөгү маалыматтар жөнүндө» мыйзамына ылайык",

            // История поездок
            "history.title": "Сапарлар тарыхы",
            "history.empty": "Сизде азырынча сапарлар жок",

            // Отзывы
            "review.title": "Сапарды баалаңыз",
            "review.how_was_trip": "Сапар кандай болду?",
            "review.placeholder": "Комментарий калтырыңыз (милдеттүү эмес)...",
            "review.skip": "Өткөрүп жибер",
            "review.submit": "Жөнөтүү",
            "review.thanks": "Пикириңиз үчүн рахмат!",
            "review.community": "Сиз коомчулукту жакшыртууга жардам бересиз",
            "review.rating.0": "",
            "review.terrible": "Жаман",
            "review.bad": "Начар",
            "review.ok": "Жакшы",
            "review.good": "Жакшы",
            "review.great": "Мыкты"
        }
    }
};

let savedLng = "ru";
try {
    savedLng = localStorage.getItem('i18nextLng') || "ru";
} catch (_) {
    // Storage may be unavailable in restricted contexts.
}

i18n
    .use(initReactI18next)
    .init({
        resources,
        lng: savedLng,
        fallbackLng: "ru",
        interpolation: {
            escapeValue: false
        }
    });

export default i18n;
