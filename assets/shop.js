const SUPABASE_URL = 'https://xcubnwvyvhjfyiixunfg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_K5k9vLXtDUo8qoyWrwX3qg_qN_3xWfy';
const SHOP_PRODUCTS_TABLE = 'products';
const TRANSACTIONS_TABLE = 'transactions';
const VISIT_DATES_TABLE = 'visit_dates';
const EVENTS_TABLE = 'events';
const PROMOTIONS_TABLE = 'promotions';
const SHOP_PRODUCTS_CACHE_KEY = 'portfolio_shop_products_cache_v2';
const SHOP_PRODUCTS_CACHE_TIME_KEY = 'portfolio_shop_products_cache_time_v2';
const SHOP_PRODUCTS_CACHE_TTL_MS = 5 * 60 * 1000;
const SALES_TAX_RATE = 0.07;
const SERVICE_FEE = 2.49;
let supabaseClient;

function getSupabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        throw new Error('Supabase client is unavailable on this page.');
    }

    if (!supabaseClient) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    return supabaseClient;
}

const shopState = {
    products: [],
    cart: new Map(),
    ticketDates: new Map(),
    eventAvailability: new Map(),
    eventCalendarByProduct: new Map(),
    roundToNearestDollar: false,
    appliedPromotion: null,
    isCheckoutComplete: false
};

function formatSignedCurrency(value) {
    const absoluteAmount = formatCurrency(Math.abs(value));
    if (value > 0) return `+${absoluteAmount}`;
    if (value < 0) return `-${absoluteAmount}`;
    return absoluteAmount;
}

function getPricingSummary(subtotal, shouldRound, promotionDiscountAmount = 0) {
    const tax = subtotal > 0 ? subtotal * SALES_TAX_RATE : 0;
    const serviceFee = subtotal > 0 ? SERVICE_FEE : 0;
    const preRoundTotal = subtotal + tax + serviceFee;
    const promotionDiscount = Math.max(0, Math.min(Number(promotionDiscountAmount) || 0, preRoundTotal));
    const discountedTotal = Math.max(0, preRoundTotal - promotionDiscount);
    const total = shouldRound ? Math.ceil(discountedTotal) : discountedTotal;
    const roundingAdjustment = shouldRound ? total - discountedTotal : 0;

    return {
        subtotal,
        tax,
        serviceFee,
        promotionDiscount,
        roundingAdjustment,
        total
    };
}

function normalizePromotionCode(rawValue) {
    return String(rawValue || '').trim().toUpperCase();
}

function toNonNegativeNumber(value) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
}

function getPromotionMessageElement() {
    return document.getElementById('shop-promo-message');
}

function setPromoMessage(message, type = 'neutral') {
    const messageElement = getPromotionMessageElement();
    if (!messageElement) return;
    messageElement.textContent = message;
    messageElement.dataset.type = type;
}

function getPromotionCodeInput() {
    return document.getElementById('shop-promo-code');
}

function getApplyPromotionButton() {
    return document.getElementById('shop-apply-promo');
}

function getRemovePromotionButton() {
    return document.getElementById('shop-remove-promo');
}

function updatePromotionActionState() {
    const applyButton = getApplyPromotionButton();
    const removeButton = getRemovePromotionButton();
    if (!applyButton && !removeButton) return;

    const promotionInput = getPromotionCodeInput();
    const hasCode = Boolean(promotionInput && normalizePromotionCode(promotionInput.value));
    const subtotal = getCartSubtotal();
    const disableApply = shopState.isCheckoutComplete || subtotal <= 0 || !hasCode;
    const disableRemove = shopState.isCheckoutComplete || !shopState.appliedPromotion;

    if (applyButton) {
        applyButton.disabled = disableApply;
    }
    if (removeButton) {
        removeButton.disabled = disableRemove;
    }
}

function isPromotionDateRangeValid(startDateRaw, endDateRaw) {
    const now = new Date();

    if (startDateRaw) {
        const startDate = new Date(startDateRaw);
        if (Number.isFinite(startDate.getTime()) && now < startDate) {
            return false;
        }
    }

    if (endDateRaw) {
        const parsedEndDate = new Date(endDateRaw);
        if (Number.isFinite(parsedEndDate.getTime())) {
            const endDateIsDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(endDateRaw));
            if (endDateIsDateOnly) {
                parsedEndDate.setHours(23, 59, 59, 999);
            }
            if (now > parsedEndDate) {
                return false;
            }
        }
    }

    return true;
}

function getPromotionDiscountAmount(preDiscountTotal) {
    if (!shopState.appliedPromotion || preDiscountTotal <= 0) return 0;

    const { flatAmount, percentAmount } = shopState.appliedPromotion;
    const flatDiscount = toNonNegativeNumber(flatAmount);
    const percentDiscount = toNonNegativeNumber(percentAmount) > 0
        ? preDiscountTotal * (toNonNegativeNumber(percentAmount) / 100)
        : 0;

    const combinedDiscount = flatDiscount + percentDiscount;
    return Math.max(0, Math.min(combinedDiscount, preDiscountTotal));
}

async function loadPromotionByCode(promotionCode) {
    const normalizedCode = normalizePromotionCode(promotionCode);
    if (!normalizedCode) {
        return null;
    }

    const todayIso = getTodayIsoDate();
    const client = getSupabaseClient();
    const { data, error } = await client
        .from(PROMOTIONS_TABLE)
        .select('promotion_code, start_date, end_date, flat_amount, percent_amount')
        .not('start_date', 'is', null)
        .not('end_date', 'is', null)
        .lte('start_date', todayIso)
        .gte('end_date', todayIso)
        .order('start_date', { ascending: false })
        .limit(200);

    if (error) {
        throw new Error(`Failed to validate promotion code: ${error.message}`);
    }

    if (!Array.isArray(data) || !data.length) {
        return null;
    }

    const promotion = data.find((row) => {
        const rowCode = normalizePromotionCode(row.promotion_code);
        const hasExactCodeMatch = rowCode === normalizedCode;
        const hasValidDateRange = isPromotionDateRangeValid(row.start_date, row.end_date);
        return hasExactCodeMatch && hasValidDateRange;
    });

    if (!promotion) {
        return null;
    }

    return {
        code: normalizePromotionCode(promotion.promotion_code),
        startDate: promotion.start_date,
        endDate: promotion.end_date,
        flatAmount: toNonNegativeNumber(promotion.flat_amount),
        percentAmount: toNonNegativeNumber(promotion.percent_amount)
    };
}

function clearAppliedPromotion({ clearInput = false } = {}) {
    shopState.appliedPromotion = null;
    if (clearInput) {
        const promotionInput = getPromotionCodeInput();
        if (promotionInput) {
            promotionInput.value = '';
        }
    }
}

function handleRemovePromotion() {
    if (!shopState.appliedPromotion) {
        setPromoMessage('No promotion is currently applied.', 'neutral');
        updatePromotionActionState();
        return;
    }

    clearAppliedPromotion({ clearInput: true });
    setPromoMessage('Promotion removed.', 'neutral');
    updateTotals();
}

async function handleApplyPromotion() {
    if (shopState.isCheckoutComplete) {
        setPromoMessage('Start a new order before applying a promotion.', 'warning');
        return;
    }

    if (getCartSubtotal() <= 0) {
        setPromoMessage('Add items to your cart before applying a promotion.', 'warning');
        return;
    }

    const promotionInput = getPromotionCodeInput();
    const rawCode = promotionInput ? promotionInput.value : '';
    const promotionCode = normalizePromotionCode(rawCode);

    if (!promotionCode) {
        clearAppliedPromotion();
        setPromoMessage('Enter a promotion code to apply a discount.', 'neutral');
        updateTotals();
        return;
    }

    setPromoMessage('Checking promotion code...', 'neutral');

    let promotion;
    try {
        promotion = await loadPromotionByCode(promotionCode);
    } catch (error) {
        console.error(error);
        setPromoMessage(error.message || 'Could not validate promotion code right now.', 'error');
        return;
    }

    if (!promotion || !promotion.code) {
        clearAppliedPromotion();
        setPromoMessage('Promotion code not found.', 'error');
        updateTotals();
        return;
    }

    if (!isPromotionDateRangeValid(promotion.startDate, promotion.endDate)) {
        clearAppliedPromotion();
        setPromoMessage('This promotion is not currently active.', 'warning');
        updateTotals();
        return;
    }

    if (promotion.flatAmount <= 0 && promotion.percentAmount <= 0) {
        clearAppliedPromotion();
        setPromoMessage('This promotion does not have a valid discount amount.', 'warning');
        updateTotals();
        return;
    }

    shopState.appliedPromotion = promotion;
    if (promotionInput) {
        promotionInput.value = promotion.code;
    }

    setPromoMessage(`Promotion ${promotion.code} applied.`, 'success');
    updateTotals();
}

function getTodayIsoDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function padDatePart(value) {
    return String(value).padStart(2, '0');
}

function parseIsoDate(dateIso) {
    const normalizedDate = String(dateIso || '').trim();
    const match = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3])
    };
}

function buildIsoDate(year, month, day) {
    return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function getMonthKey(dateIso) {
    const parsedDate = parseIsoDate(dateIso);
    if (!parsedDate) return '';
    return `${parsedDate.year}-${padDatePart(parsedDate.month)}`;
}

function parseMonthKey(monthKey) {
    const normalizedMonth = String(monthKey || '').trim();
    const match = normalizedMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return {
        year: Number(match[1]),
        month: Number(match[2])
    };
}

function shiftMonthKey(monthKey, delta) {
    const parsedMonth = parseMonthKey(monthKey);
    if (!parsedMonth) return getMonthKey(getTodayIsoDate());

    const shiftedDate = new Date(Date.UTC(parsedMonth.year, parsedMonth.month - 1 + delta, 1));
    return `${shiftedDate.getUTCFullYear()}-${padDatePart(shiftedDate.getUTCMonth() + 1)}`;
}

function getDaysInMonth(monthKey) {
    const parsedMonth = parseMonthKey(monthKey);
    if (!parsedMonth) return 0;
    return new Date(Date.UTC(parsedMonth.year, parsedMonth.month, 0)).getUTCDate();
}

function getFirstWeekdayOfMonth(monthKey) {
    const parsedMonth = parseMonthKey(monthKey);
    if (!parsedMonth) return 0;
    return new Date(Date.UTC(parsedMonth.year, parsedMonth.month - 1, 1)).getUTCDay();
}

function formatMonthLabel(monthKey) {
    const parsedMonth = parseMonthKey(monthKey);
    if (!parsedMonth) return monthKey;
    const displayDate = new Date(Date.UTC(parsedMonth.year, parsedMonth.month - 1, 1));
    return displayDate.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function getSpotsLeftLabel(eventAvailability) {
    if (!eventAvailability || !eventAvailability.exists) return 'Unavailable';
    if (!Number.isFinite(eventAvailability.remaining)) return 'Unlimited spots left';
    return `${eventAvailability.remaining} spots left`;
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeComparableName(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getRowFieldValue(row, fieldNames) {
    if (!row || typeof row !== 'object') return undefined;
    for (const fieldName of fieldNames) {
        if (Object.prototype.hasOwnProperty.call(row, fieldName)) {
            return row[fieldName];
        }
    }
    return undefined;
}

function normalizeDateValueToIso(rawDateValue) {
    const rawValue = String(rawDateValue || '').trim();
    if (!rawValue) return '';

    const directIsoMatch = rawValue.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directIsoMatch) {
        return directIsoMatch[1];
    }

    const parsedDate = new Date(rawValue);
    if (!Number.isFinite(parsedDate.getTime())) {
        return '';
    }

    const year = parsedDate.getUTCFullYear();
    const month = padDatePart(parsedDate.getUTCMonth() + 1);
    const day = padDatePart(parsedDate.getUTCDate());
    return `${year}-${month}-${day}`;
}

function matchesEventProduct(product, eventTypeValue) {
    const normalizedEventType = normalizeComparableName(eventTypeValue);
    if (!normalizedEventType) return false;
    const normalizedProductName = normalizeComparableName(product && product.name);
    return normalizedEventType === normalizedProductName;
}

function isTicketProduct(product) {
    if (!product) return false;
    const category = String(product.category || '').toLowerCase();
    const name = String(product.name || '').toLowerCase();
    return category === 'experience' || category === 'education' || /ticket|pass|workshop|tour/.test(name);
}

function requiresVisitDate(product) {
    return isTicketProduct(product);
}

function isUnlimitedInventoryValue(value) {
    return Number(value) === -1;
}

function toBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    return fallback;
}

function shouldShowAvailability(product) {
    if (!product) return false;
    if (isTicketProduct(product)) {
        return toBoolean(product.showCapacity, true);
    }
    return true;
}

function getInventoryLimit(product) {
    if (!product) return 0;

    if (requiresVisitDate(product)) {
        const eventDate = getTicketDate(product.id);
        if (!eventDate) {
            return Number.POSITIVE_INFINITY;
        }

        const eventAvailability = getStoredEventAvailability(product.id, eventDate);
        if (!eventAvailability || !eventAvailability.exists) {
            return 0;
        }

        if (!Number.isFinite(eventAvailability.remaining)) {
            return Number.POSITIVE_INFINITY;
        }

        return Math.max(0, Math.floor(Number(eventAvailability.remaining) || 0));
    }

    const sourceValue = product.stock;
    const parsedValue = Number(sourceValue);
    if (!Number.isFinite(parsedValue)) return 0;
    if (isUnlimitedInventoryValue(parsedValue)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor(parsedValue));
}

function getRemainingQuantity(product) {
    const inventoryLimit = getInventoryLimit(product);
    const quantityInCart = shopState.cart.get(product.id) || 0;
    if (!Number.isFinite(inventoryLimit)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, inventoryLimit - quantityInCart);
}

function getAvailabilityText(product) {
    if (!product || !shouldShowAvailability(product)) return '';

    if (requiresVisitDate(product)) {
        const eventDate = getTicketDate(product.id);
        if (!eventDate) {
            return 'Select a visit date in your cart for availability';
        }

        const eventAvailability = getStoredEventAvailability(product.id, eventDate);
        if (!eventAvailability) {
            return 'Checking event availability...';
        }

        if (!eventAvailability.exists) {
            return 'No event scheduled for selected date';
        }

        if (!Number.isFinite(eventAvailability.remaining)) {
            return 'Unlimited spots';
        }

        return `${eventAvailability.remaining} spots left`;
    }

    if (!Number.isFinite(getInventoryLimit(product))) {
        return isTicketProduct(product) ? 'Unlimited spots' : 'Unlimited stock';
    }

    const remaining = getRemainingQuantity(product);
    return isTicketProduct(product) ? `${remaining} spots left` : `${remaining} in stock`;
}

function getTicketDate(productId) {
    return shopState.ticketDates.get(productId) || '';
}

function getEventAvailabilityKey(productId, eventDate) {
    return `${String(productId || '').trim()}::${String(eventDate || '').trim()}`;
}

function clearEventAvailabilityForProduct(productId) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) return;

    const keysToDelete = Array.from(shopState.eventAvailability.keys()).filter((key) => {
        return key.startsWith(`${normalizedProductId}::`);
    });

    keysToDelete.forEach((key) => {
        shopState.eventAvailability.delete(key);
    });
}

function clearEventCalendarForProduct(productId) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) return;
    shopState.eventCalendarByProduct.delete(normalizedProductId);
}

function getCachedEventCalendarForProduct(productId) {
    const normalizedProductId = String(productId || '').trim();
    if (!normalizedProductId) return null;
    return shopState.eventCalendarByProduct.get(normalizedProductId) || null;
}

function getStoredEventAvailability(productId, eventDate) {
    if (!productId || !eventDate) return null;
    const key = getEventAvailabilityKey(productId, eventDate);
    return shopState.eventAvailability.get(key) || null;
}

function normalizeEventAvailabilityRow(row) {
    if (!row) return null;

    const eventDateRaw = getRowFieldValue(row, ['event_date', 'eventDate', 'event date', 'date']);
    const eventDateIso = normalizeDateValueToIso(eventDateRaw);
    if (!eventDateIso) {
        return null;
    }

    const eventTypeRaw = getRowFieldValue(row, ['event_type', 'eventType', 'event type', 'type']);
    const eventType = String(eventTypeRaw || '').trim();

    const capacityRaw = Number(getRowFieldValue(row, ['capacity']));
    const spotsPurchasedValue = getRowFieldValue(row, ['spots_purchased', 'spotsPurchased', 'spots purchased']);
    const spotsPurchasedRaw = Number(spotsPurchasedValue);
    if (!Number.isFinite(capacityRaw)) {
        return null;
    }

    const isUnlimited = isUnlimitedInventoryValue(capacityRaw);
    const normalizedCapacity = isUnlimited ? -1 : Math.max(0, Math.floor(capacityRaw));
    const normalizedPurchasedBase = Number.isFinite(spotsPurchasedRaw) ? spotsPurchasedRaw : 0;
    let normalizedPurchased = Math.max(0, Math.floor(normalizedPurchasedBase));
    if (!isUnlimited && normalizedPurchased > normalizedCapacity) {
        normalizedPurchased = normalizedCapacity;
    }

    const remaining = isUnlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, normalizedCapacity - normalizedPurchased);

    return {
        id: String(row.id || '').trim(),
        eventType,
        eventDate: eventDateIso,
        capacity: normalizedCapacity,
        spotsPurchased: normalizedPurchased,
        remaining,
        exists: true
    };
}

function selectPreferredAvailability(currentAvailability, nextAvailability) {
    if (!currentAvailability) return nextAvailability;
    if (!nextAvailability) return currentAvailability;

    const currentRemaining = currentAvailability.remaining;
    const nextRemaining = nextAvailability.remaining;

    if (!Number.isFinite(currentRemaining) && Number.isFinite(nextRemaining)) {
        return currentAvailability;
    }
    if (Number.isFinite(currentRemaining) && !Number.isFinite(nextRemaining)) {
        return nextAvailability;
    }

    if (nextRemaining > currentRemaining) {
        return nextAvailability;
    }

    return currentAvailability;
}

async function fetchEventAvailability(product, eventDate) {
    if (!product || !eventDate || !requiresVisitDate(product)) return null;

    const calendarMap = await preloadEventCalendar(product, { force: true });
    const selectedAvailability = calendarMap.get(eventDate) || null;
    if (!selectedAvailability) {
        return {
            id: '',
            eventType: product.name,
            eventDate,
            capacity: 0,
            spotsPurchased: 0,
            remaining: 0,
            exists: false
        };
    }

    return selectedAvailability;
}

async function refreshEventAvailability(product, { showErrors = false } = {}) {
    if (!product || !requiresVisitDate(product)) return null;

    const eventDate = getTicketDate(product.id);
    clearEventAvailabilityForProduct(product.id);
    if (!eventDate) return null;

    try {
        const availability = await fetchEventAvailability(product, eventDate);
        const key = getEventAvailabilityKey(product.id, eventDate);
        shopState.eventAvailability.set(key, availability);
        return availability;
    } catch (error) {
        if (showErrors) {
            setFormMessage(error.message || 'Could not load event availability.', 'error');
        }
        return null;
    }
}

async function fetchEventCalendarAvailability(product) {
    if (!product || !requiresVisitDate(product)) return new Map();

    const client = getSupabaseClient();
    const todayIso = getTodayIsoDate();
    const { data: strictData, error: strictError } = await client
        .from(EVENTS_TABLE)
        .select('*')
        .eq('event_type', product.name)
        .gte('event_date', todayIso)
        .order('event_date', { ascending: true })
        .limit(5000);

    if (strictError) {
        throw new Error(`Could not load calendar availability for ${product.name}: ${strictError.message}`);
    }

    let rows = Array.isArray(strictData) ? strictData : [];

    if (!rows.length) {
        const { data: fallbackData, error: fallbackError } = await client
            .from(EVENTS_TABLE)
            .select('*')
            .gte('event_date', todayIso)
            .order('event_date', { ascending: true })
            .limit(5000);

        if (fallbackError) {
            throw new Error(`Could not load fallback calendar availability for ${product.name}: ${fallbackError.message}`);
        }

        const fallbackRows = Array.isArray(fallbackData) ? fallbackData : [];
        rows = fallbackRows.filter((row) => {
            const rowEventType = getRowFieldValue(row, ['event_type', 'eventType', 'event type', 'type']);
            return matchesEventProduct(product, rowEventType);
        });
    }

    const calendarMap = new Map();
    rows.forEach((row) => {
        const normalizedRow = normalizeEventAvailabilityRow(row);
        if (!normalizedRow || !normalizedRow.eventDate) return;
        if (normalizedRow.eventDate < todayIso) return;

        const existingEntry = calendarMap.get(normalizedRow.eventDate) || null;
        const preferredEntry = selectPreferredAvailability(existingEntry, normalizedRow);
        calendarMap.set(normalizedRow.eventDate, preferredEntry);
    });

    calendarMap.forEach((availability, eventDate) => {
        const eventKey = getEventAvailabilityKey(product.id, eventDate);
        shopState.eventAvailability.set(eventKey, availability);
    });

    return calendarMap;
}

async function preloadEventCalendar(product, { force = false } = {}) {
    if (!product || !requiresVisitDate(product)) return new Map();

    const cachedCalendar = getCachedEventCalendarForProduct(product.id);
    if (cachedCalendar && !force) {
        return cachedCalendar;
    }

    const loadedCalendar = await fetchEventCalendarAvailability(product);
    shopState.eventCalendarByProduct.set(String(product.id || '').trim(), loadedCalendar);
    return loadedCalendar;
}

function setTicketDate(productId, value) {
    if (!value) {
        shopState.ticketDates.delete(productId);
        clearEventAvailabilityForProduct(productId);
        return;
    }
    shopState.ticketDates.set(productId, value);
}

async function applyTicketDateSelection(product, selectedDate, { showErrors = true } = {}) {
    if (!product || !selectedDate) {
        return { ok: false, reason: 'Please select a valid date.' };
    }

    try {
        const calendarMap = await preloadEventCalendar(product);
        const selectedAvailability = calendarMap.get(selectedDate) || null;

        if (!selectedAvailability || !selectedAvailability.exists) {
            return { ok: false, reason: `No event is scheduled for ${product.name} on ${selectedDate}.` };
        }

        if (Number.isFinite(selectedAvailability.remaining) && selectedAvailability.remaining <= 0) {
            return { ok: false, reason: `${product.name} is fully booked on ${selectedDate}.` };
        }

        setTicketDate(product.id, selectedDate);
        const eventKey = getEventAvailabilityKey(product.id, selectedDate);
        shopState.eventAvailability.set(eventKey, selectedAvailability);

        const quantityInCart = shopState.cart.get(product.id) || 0;
        if (Number.isFinite(selectedAvailability.remaining) && quantityInCart > selectedAvailability.remaining) {
            if (selectedAvailability.remaining <= 0) {
                shopState.cart.delete(product.id);
                shopState.ticketDates.delete(product.id);
                clearEventAvailabilityForProduct(product.id);
            } else {
                shopState.cart.set(product.id, selectedAvailability.remaining);
            }
            return {
                ok: true,
                availability: selectedAvailability,
                adjusted: true,
                message: `Updated quantity for ${product.name} to match available spots.`
            };
        }

        return { ok: true, availability: selectedAvailability, adjusted: false };
    } catch (error) {
        if (showErrors) {
            setFormMessage(error.message || 'Could not load event availability.', 'error');
        }
        return { ok: false, reason: error.message || 'Could not load event availability.' };
    }
}

function createTicketCalendarGrid(product, monthKey, selectedDate, calendarMap, onSelectDate) {
    const calendarGrid = document.createElement('div');
    calendarGrid.className = 'shop-ticket-calendar-grid';

    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekdayLabels.forEach((weekday) => {
        const weekdayElement = document.createElement('span');
        weekdayElement.className = 'shop-ticket-calendar-weekday';
        weekdayElement.textContent = weekday;
        calendarGrid.appendChild(weekdayElement);
    });

    const totalDays = getDaysInMonth(monthKey);
    const leadingDays = getFirstWeekdayOfMonth(monthKey);
    const parsedMonth = parseMonthKey(monthKey);
    if (!parsedMonth) {
        return calendarGrid;
    }
    const todayIso = getTodayIsoDate();

    for (let index = 0; index < leadingDays; index += 1) {
        const filler = document.createElement('span');
        filler.className = 'shop-ticket-calendar-day is-empty';
        filler.setAttribute('aria-hidden', 'true');
        calendarGrid.appendChild(filler);
    }

    for (let day = 1; day <= totalDays; day += 1) {
        const isoDate = buildIsoDate(parsedMonth.year, parsedMonth.month, day);
        const dayButton = document.createElement('button');
        dayButton.type = 'button';
        dayButton.className = 'shop-ticket-calendar-day';
        dayButton.textContent = String(day);

        const dayAvailability = calendarMap.get(isoDate) || null;
        const isInPast = isoDate < todayIso;
        const isAvailable = !isInPast && dayAvailability && dayAvailability.exists
            && (!Number.isFinite(dayAvailability.remaining) || dayAvailability.remaining > 0);

        if (selectedDate === isoDate) {
            dayButton.classList.add('is-selected');
        }

        if (!isAvailable) {
            dayButton.disabled = true;
            dayButton.classList.add('is-unavailable');
        } else {
            dayButton.addEventListener('click', () => {
                onSelectDate(isoDate);
            });
        }

        calendarGrid.appendChild(dayButton);
    }

    return calendarGrid;
}

function getFirstAvailableEventDate(calendarMap) {
    if (!(calendarMap instanceof Map)) return null;

    for (const [eventDate, availability] of calendarMap.entries()) {
        if (!availability || !availability.exists) continue;
        if (!Number.isFinite(availability.remaining) || availability.remaining > 0) {
            return eventDate;
        }
    }

    return null;
}

function getTicketDateModalElements() {
    const overlay = document.getElementById('shop-ticket-modal-overlay');
    if (!overlay) return null;

    return {
        overlay,
        panel: overlay.querySelector('.shop-ticket-modal-panel'),
        title: overlay.querySelector('.shop-ticket-modal-title'),
        summary: overlay.querySelector('.shop-ticket-modal-summary'),
        body: overlay.querySelector('.shop-ticket-modal-body'),
        capacity: overlay.querySelector('.shop-ticket-modal-capacity'),
        quantityInput: overlay.querySelector('.shop-ticket-modal-quantity'),
        addButton: overlay.querySelector('.shop-ticket-modal-add'),
        closeButton: overlay.querySelector('.shop-ticket-modal-close')
    };
}

function ensureTicketDateModal() {
    const existingModal = getTicketDateModalElements();
    if (existingModal) return existingModal;

    const overlay = document.createElement('div');
    overlay.id = 'shop-ticket-modal-overlay';
    overlay.className = 'shop-ticket-modal-overlay';
    overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'shop-ticket-modal-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'shop-ticket-modal-header';

    const title = document.createElement('h4');
    title.className = 'shop-ticket-modal-title';
    title.textContent = 'Choose Visit Date';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'shop-ticket-modal-close';
    closeButton.textContent = 'Close';

    const summary = document.createElement('p');
    summary.className = 'shop-ticket-modal-summary';
    summary.textContent = 'Select an available date.';

    const body = document.createElement('div');
    body.className = 'shop-ticket-modal-body';

    const calendarPane = document.createElement('section');
    calendarPane.className = 'shop-ticket-modal-calendar-pane';

    const sidePane = document.createElement('aside');
    sidePane.className = 'shop-ticket-modal-side-pane';

    const capacity = document.createElement('p');
    capacity.className = 'shop-ticket-modal-capacity';
    capacity.textContent = 'Capacity: Select a date';

    const quantityLabel = document.createElement('label');
    quantityLabel.className = 'shop-ticket-modal-quantity-label';
    quantityLabel.textContent = 'Tickets';

    const quantityInput = document.createElement('input');
    quantityInput.type = 'number';
    quantityInput.min = '1';
    quantityInput.step = '1';
    quantityInput.value = '1';
    quantityInput.className = 'shop-ticket-modal-quantity';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'shop-ticket-modal-add';
    addButton.textContent = 'Add to Cart';

    quantityLabel.appendChild(quantityInput);
    sidePane.append(capacity, quantityLabel, addButton);
    body.append(calendarPane, sidePane);

    header.append(title, closeButton);
    panel.append(header, summary, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeTicketDateModal();
        }
    });

    closeButton.addEventListener('click', () => {
        closeTicketDateModal();
    });

    return getTicketDateModalElements();
}

function closeTicketDateModal() {
    const modalElements = getTicketDateModalElements();
    if (!modalElements) return;
    modalElements.overlay.hidden = true;
    delete modalElements.overlay.dataset.productId;
    delete modalElements.overlay.dataset.monthKey;
    delete modalElements.overlay.dataset.selectedDate;
}

async function renderTicketDateModal(product) {
    const modalElements = ensureTicketDateModal();
    if (!modalElements || !product) return;

    const existingCartDate = getTicketDate(product.id);
    const requestedSelectedDate = String(modalElements.overlay.dataset.selectedDate || '').trim() || existingCartDate;
    const todayMonth = getMonthKey(getTodayIsoDate());
    const selectedMonth = getMonthKey(requestedSelectedDate);
    let monthKey = String(modalElements.overlay.dataset.monthKey || '').trim() || selectedMonth || todayMonth;
    if (monthKey < todayMonth) {
        monthKey = todayMonth;
    }
    modalElements.overlay.dataset.monthKey = monthKey;

    modalElements.title.textContent = `${product.name}`;
    modalElements.summary.textContent = 'Loading calendar...';

    const calendarPane = modalElements.body.querySelector('.shop-ticket-modal-calendar-pane');
    const sidePane = modalElements.body.querySelector('.shop-ticket-modal-side-pane');
    if (!calendarPane || !sidePane || !modalElements.capacity || !modalElements.quantityInput || !modalElements.addButton) {
        return;
    }

    calendarPane.innerHTML = '<p class="shop-ticket-calendar-loading">Loading calendar...</p>';

    let calendarMap;
    try {
        calendarMap = await preloadEventCalendar(product, { force: true });
    } catch (error) {
        modalElements.summary.textContent = error.message || 'Could not load dates right now.';
        calendarPane.innerHTML = '<p class="shop-ticket-calendar-loading">Could not load calendar.</p>';
        modalElements.capacity.textContent = 'Capacity: Unavailable';
        modalElements.addButton.disabled = true;
        return;
    }

    if (!modalElements.overlay.isConnected || modalElements.overlay.hidden) return;

    calendarPane.innerHTML = '';

    let selectedDate = requestedSelectedDate;
    if (!selectedDate || !calendarMap.has(selectedDate)) {
        selectedDate = getFirstAvailableEventDate(calendarMap) || '';
        modalElements.overlay.dataset.selectedDate = selectedDate;
    }

    const nav = document.createElement('div');
    nav.className = 'shop-ticket-calendar-nav';

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'shop-ticket-calendar-nav-btn';
    prevButton.textContent = '‹';
    prevButton.disabled = monthKey <= todayMonth;
    prevButton.addEventListener('click', async () => {
        modalElements.overlay.dataset.monthKey = shiftMonthKey(monthKey, -1);
        await renderTicketDateModal(product);
    });

    const monthLabel = document.createElement('strong');
    monthLabel.className = 'shop-ticket-calendar-month';
    monthLabel.textContent = formatMonthLabel(monthKey);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'shop-ticket-calendar-nav-btn';
    nextButton.textContent = '›';
    nextButton.addEventListener('click', async () => {
        modalElements.overlay.dataset.monthKey = shiftMonthKey(monthKey, 1);
        await renderTicketDateModal(product);
    });

    nav.append(prevButton, monthLabel, nextButton);

    const grid = createTicketCalendarGrid(product, monthKey, selectedDate, calendarMap, async (isoDate) => {
        modalElements.overlay.dataset.selectedDate = isoDate;
        await renderTicketDateModal(product);
    });

    calendarPane.append(nav, grid);

    const selectedAvailability = selectedDate ? (calendarMap.get(selectedDate) || getStoredEventAvailability(product.id, selectedDate)) : null;
    const selectedRemaining = selectedAvailability && selectedAvailability.exists
        ? selectedAvailability.remaining
        : 0;

    const existingQuantity = shopState.cart.get(product.id) || 0;
    const existingDate = getTicketDate(product.id);
    const existingQuantityForSelectedDate = existingDate && existingDate === selectedDate ? existingQuantity : 0;
    const maxQuantityForSelection = Number.isFinite(selectedRemaining)
        ? Math.max(0, Math.floor(selectedRemaining - existingQuantityForSelectedDate))
        : Number.POSITIVE_INFINITY;

    if (selectedDate && selectedAvailability && selectedAvailability.exists) {
        modalElements.capacity.textContent = `Capacity: ${getSpotsLeftLabel(selectedAvailability)}`;
    } else {
        modalElements.capacity.textContent = 'Capacity: Unavailable';
    }

    const quantityValueRaw = Number.parseInt(modalElements.quantityInput.value, 10);
    let quantityValue = Number.isFinite(quantityValueRaw) && quantityValueRaw > 0 ? quantityValueRaw : 1;
    if (Number.isFinite(maxQuantityForSelection)) {
        quantityValue = Math.max(1, Math.min(quantityValue, maxQuantityForSelection || 1));
        modalElements.quantityInput.max = String(maxQuantityForSelection || 1);
    } else {
        modalElements.quantityInput.removeAttribute('max');
    }
    modalElements.quantityInput.value = String(quantityValue);
    modalElements.quantityInput.oninput = () => {
        const nextRaw = Number.parseInt(modalElements.quantityInput.value, 10);
        if (!Number.isFinite(nextRaw) || nextRaw < 1) {
            modalElements.quantityInput.value = '1';
            return;
        }
        if (Number.isFinite(maxQuantityForSelection) && nextRaw > maxQuantityForSelection) {
            modalElements.quantityInput.value = String(maxQuantityForSelection || 1);
        }
    };

    const canAdd = Boolean(selectedDate && selectedAvailability && selectedAvailability.exists
        && (!Number.isFinite(maxQuantityForSelection) || maxQuantityForSelection > 0));

    modalElements.addButton.disabled = !canAdd;
    modalElements.addButton.onclick = async () => {
        if (!canAdd) {
            setFormMessage('Select an available date before adding tickets.', 'warning');
            return;
        }

        const chosenDate = String(modalElements.overlay.dataset.selectedDate || '').trim();
        const chosenQuantityRaw = Number.parseInt(modalElements.quantityInput.value, 10);
        const chosenQuantity = Number.isFinite(chosenQuantityRaw) && chosenQuantityRaw > 0 ? chosenQuantityRaw : 1;

        const selectionResult = await applyTicketDateSelection(product, chosenDate, { showErrors: true });
        if (!selectionResult.ok) {
            setFormMessage(selectionResult.reason || 'Unable to use this date.', 'warning');
            return;
        }

        const latestAvailability = selectionResult.availability;
        if (!latestAvailability || !latestAvailability.exists) {
            setFormMessage('Selected date is not available.', 'warning');
            return;
        }

        const currentCartQuantity = shopState.cart.get(product.id) || 0;
        const currentCartDate = getTicketDate(product.id);
        const baseQuantity = currentCartDate === chosenDate ? currentCartQuantity : 0;
        const remainingForAdd = Number.isFinite(latestAvailability.remaining)
            ? Math.max(0, Math.floor(latestAvailability.remaining - baseQuantity))
            : Number.POSITIVE_INFINITY;

        if (Number.isFinite(remainingForAdd) && remainingForAdd <= 0) {
            setFormMessage(`No additional spots available for ${product.name} on ${chosenDate}.`, 'warning');
            return;
        }

        const quantityToAdd = Number.isFinite(remainingForAdd)
            ? Math.min(chosenQuantity, remainingForAdd)
            : chosenQuantity;
        const nextQuantity = baseQuantity + quantityToAdd;

        shopState.ticketDates.set(product.id, chosenDate);
        shopState.cart.set(product.id, nextQuantity);

        const eventKey = getEventAvailabilityKey(product.id, chosenDate);
        shopState.eventAvailability.set(eventKey, latestAvailability);

        if (quantityToAdd < chosenQuantity) {
            setFormMessage(`Added ${quantityToAdd} ticket(s) for ${product.name}. Availability limit reached.`, 'warning');
        } else {
            setFormMessage(`Added ${quantityToAdd} ticket(s) for ${product.name} on ${chosenDate}.`, 'success');
        }

        closeTicketDateModal();
        renderCart();
    };

    if (selectedDate && selectedAvailability && selectedAvailability.exists) {
        modalElements.summary.textContent = `Selected ${selectedDate} · ${getSpotsLeftLabel(selectedAvailability)}`;
    } else if (selectedDate) {
        modalElements.summary.textContent = `Selected ${selectedDate} · Unavailable`;
    } else {
        modalElements.summary.textContent = 'No available dates found for this ticket.';
    }
}

async function openTicketDateModal(product) {
    if (!product) return;

    const modalElements = ensureTicketDateModal();
    if (!modalElements) return;

    modalElements.overlay.hidden = false;
    modalElements.overlay.dataset.productId = String(product.id || '').trim();
    modalElements.overlay.dataset.monthKey = getMonthKey(getTicketDate(product.id) || getTodayIsoDate());
    modalElements.overlay.dataset.selectedDate = getTicketDate(product.id) || '';
    await renderTicketDateModal(product);
}

function getCheckoutForm() {
    return document.getElementById('shop-checkout-form');
}

function getStartNewOrderButton() {
    return document.getElementById('shop-start-new-order');
}

function setCheckoutInputsDisabled(isDisabled) {
    const form = getCheckoutForm();
    if (!form) return;
    form.querySelectorAll('input').forEach((input) => {
        input.disabled = isDisabled;
    });

    const applyPromotionButton = getApplyPromotionButton();
    if (applyPromotionButton) {
        applyPromotionButton.disabled = isDisabled;
    }
}

function updateCheckoutActionState() {
    const startNewOrderButton = getStartNewOrderButton();
    if (!startNewOrderButton) return;
    startNewOrderButton.hidden = !shopState.isCheckoutComplete;
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(value);
}

function getCartEntries() {
    return Array.from(shopState.cart.entries())
        .map(([productId, quantity]) => {
            const product = shopState.products.find((item) => item.id === productId);
            if (!product) return null;
            if (product.isHidden || isRoundingProductName(product.name)) return null;
            return {
                product,
                quantity,
                lineTotal: product.price * quantity
            };
        })
        .filter(Boolean);
}

function getCartSubtotal() {
    return getCartEntries().reduce((sum, item) => sum + item.lineTotal, 0);
}

function createTransactionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
    }

    const timestampPart = Date.now().toString(36);
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `${timestampPart}-${randomPart}`;
}

function createTransactionRows(transactionId, contactDetails, cartEntries, transactionStatus) {
    const statusValue = transactionStatus ? 1 : 0;

    const rows = cartEntries.map(({ product, quantity }) => ({
        transaction_id: transactionId,
        contact_name: contactDetails.name,
        contact_email: contactDetails.email,
        contact_shipping_address: contactDetails.shippingAddress,
        contact_city: contactDetails.city,
        contact_postal: contactDetails.postalCode,
        product_id: product.id,
        product_price: product.price,
        transaction_status: statusValue,
        quantity
    }));

    const roundingAdjustment = Number(contactDetails.roundingAdjustment);
    const roundingProductId = String(contactDetails.roundingProductId || '').trim();
    if (shopState.roundToNearestDollar && roundingProductId) {
        rows.push({
            transaction_id: transactionId,
            contact_name: contactDetails.name,
            contact_email: contactDetails.email,
            contact_shipping_address: contactDetails.shippingAddress,
            contact_city: contactDetails.city,
            contact_postal: contactDetails.postalCode,
            product_id: roundingProductId,
            product_price: Number.isFinite(roundingAdjustment) ? roundingAdjustment : 0,
            transaction_status: statusValue,
            quantity: 1
        });
    }

    return rows;
}

async function insertTransactionRows(rows) {
    if (!rows.length) return;

    const client = getSupabaseClient();
    const { error } = await client
        .from(TRANSACTIONS_TABLE)
        .insert(rows);

    if (error) {
        throw new Error(`Could not record transaction rows: ${error.message}`);
    }
}

function createVisitDateRows(transactionId, contactName, cartEntries) {
    if (!transactionId || !Array.isArray(cartEntries) || !cartEntries.length) return [];

    const visitorsByDate = new Map();
    for (const { product, quantity } of cartEntries) {
        if (!requiresVisitDate(product)) continue;
        const visitDate = getTicketDate(product.id);
        if (!visitDate) continue;
        const currentVisitors = visitorsByDate.get(visitDate) || 0;
        const nextVisitors = currentVisitors + Math.max(0, Math.floor(Number(quantity) || 0));
        visitorsByDate.set(visitDate, nextVisitors);
    }

    if (!visitorsByDate.size) return [];

    const visitorContact = String(contactName || '').trim();
    return Array.from(visitorsByDate.entries()).map(([visitDate, totalVisitors]) => ({
        transaction_id: transactionId,
        date_visiting: visitDate,
        total_visitors: totalVisitors,
        visitor_contact: visitorContact
    }));
}

async function insertVisitDateRows(rows) {
    if (!rows.length) return;

    const client = getSupabaseClient();
    const { error } = await client
        .from(VISIT_DATES_TABLE)
        .insert(rows);

    if (error) {
        throw new Error(`Could not record visit dates: ${error.message}`);
    }
}

function updateTotals() {
    const subtotal = getCartSubtotal();
    const basePricingSummary = getPricingSummary(subtotal, false, 0);
    const promotionDiscountAmount = getPromotionDiscountAmount(basePricingSummary.total);
    const pricingSummary = getPricingSummary(subtotal, shopState.roundToNearestDollar, promotionDiscountAmount);

    const subtotalElement = document.getElementById('shop-subtotal');
    const taxElement = document.getElementById('shop-tax');
    const serviceFeeElement = document.getElementById('shop-service-fee');
    const promoRowElement = document.getElementById('shop-promo-row');
    const promoDiscountElement = document.getElementById('shop-promo-discount');
    const roundingRowElement = document.getElementById('shop-rounding-row');
    const roundingElement = document.getElementById('shop-rounding');
    const roundingHelpElement = document.getElementById('shop-rounding-help');
    const totalElement = document.getElementById('shop-total');

    if (subtotalElement) subtotalElement.textContent = formatCurrency(pricingSummary.subtotal);
    if (taxElement) taxElement.textContent = formatCurrency(pricingSummary.tax);
    if (serviceFeeElement) serviceFeeElement.textContent = formatCurrency(pricingSummary.serviceFee);
    if (promoDiscountElement) promoDiscountElement.textContent = formatSignedCurrency(-pricingSummary.promotionDiscount);
    if (promoRowElement) {
        promoRowElement.hidden = pricingSummary.promotionDiscount <= 0;
    }
    if (roundingElement) roundingElement.textContent = formatSignedCurrency(pricingSummary.roundingAdjustment);
    if (roundingRowElement) {
        const showRoundingLine = pricingSummary.subtotal > 0 && shopState.roundToNearestDollar;
        roundingRowElement.hidden = !showRoundingLine;
    }

    if (roundingHelpElement) {
        if (pricingSummary.subtotal <= 0) {
            roundingHelpElement.textContent = 'Add items to preview how rounding affects your total.';
        } else if (shopState.roundToNearestDollar) {
            roundingHelpElement.textContent = `Rounding adjustment applied: ${formatSignedCurrency(pricingSummary.roundingAdjustment)}.`;
        } else {
            const roundedPreview = getPricingSummary(subtotal, true, promotionDiscountAmount);
            roundingHelpElement.textContent = `If enabled now, adjustment would be ${formatSignedCurrency(roundedPreview.roundingAdjustment)}.`;
        }
    }

    if (totalElement) totalElement.textContent = formatCurrency(pricingSummary.total);

    const placeOrderButton = document.getElementById('shop-place-order');
    if (placeOrderButton) {
        placeOrderButton.disabled = subtotal <= 0 || shopState.isCheckoutComplete;
    }

    updatePromotionActionState();
    updateCheckoutActionState();
}

function setFormMessage(message, type = 'neutral') {
    const messageElement = document.getElementById('shop-form-message');
    if (!messageElement) return;

    messageElement.textContent = message;
    messageElement.dataset.type = type;
}

function syncRoundPreference() {
    const roundToggle = document.getElementById('shop-round-toggle');
    shopState.roundToNearestDollar = Boolean(roundToggle && roundToggle.checked);
}

function isRoundingProductName(name) {
    const normalizedName = String(name || '').trim().toLowerCase();
    return normalizedName === 'rounding' || normalizedName.includes('rounding');
}

async function getRoundingProduct() {
    if (!Array.isArray(shopState.products) || !shopState.products.length) {
        shopState.products = [];
    }

    const exactMatch = shopState.products.find((product) => {
        const normalizedName = String(product.name || '').trim().toLowerCase();
        return normalizedName === 'rounding';
    });

    if (exactMatch) {
        return exactMatch;
    }

    const fuzzyMatch = shopState.products.find((product) => {
        return isRoundingProductName(product.name);
    }) || null;

    if (fuzzyMatch) {
        return fuzzyMatch;
    }

    try {
        const client = getSupabaseClient();
        const { data, error } = await client
            .from(SHOP_PRODUCTS_TABLE)
            .select('id, product_name, category, description, unit_price, stock, is_hidden, show_capacity')
            .ilike('product_name', '%rounding%')
            .order('product_name', { ascending: true })
            .limit(25);

        if (error) {
            return null;
        }

        const mappedMatches = mapProductsResponseRows(data);
        const fallbackRounding = mappedMatches.find((product) => {
            const normalizedName = String(product.name || '').trim().toLowerCase();
            return normalizedName === 'rounding';
        }) || mappedMatches.find((product) => isRoundingProductName(product.name)) || null;

        if (!fallbackRounding) {
            return null;
        }

        const alreadyTracked = shopState.products.some((product) => product.id === fallbackRounding.id);
        if (!alreadyTracked) {
            shopState.products.push(fallbackRounding);
        }

        return fallbackRounding;
    } catch {
        return null;
    }
}

function createQuantityInput(product, quantity) {
    const maxQuantity = getInventoryLimit(product);
    const hasUnlimitedQuantity = !Number.isFinite(maxQuantity);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    if (!hasUnlimitedQuantity) {
        input.max = String(maxQuantity);
    }
    input.step = '1';
    input.value = String(quantity);
    input.className = 'shop-quantity-input';
    input.setAttribute('aria-label', 'Quantity');
    input.addEventListener('change', () => {
        const parsedValue = Number.parseInt(input.value, 10);

        if (!Number.isFinite(parsedValue) || parsedValue < 1) {
            shopState.cart.delete(product.id);
            shopState.ticketDates.delete(product.id);
            clearEventAvailabilityForProduct(product.id);
            clearEventCalendarForProduct(product.id);
            renderCart();
            return;
        }

        const clampedValue = hasUnlimitedQuantity ? parsedValue : Math.min(parsedValue, maxQuantity);
        if (clampedValue <= 0) {
            shopState.cart.delete(product.id);
            shopState.ticketDates.delete(product.id);
            clearEventAvailabilityForProduct(product.id);
            clearEventCalendarForProduct(product.id);
        } else {
            if (clampedValue !== parsedValue) {
                setFormMessage(`Max available quantity is ${maxQuantity} for this item.`, 'warning');
            }
            shopState.cart.set(product.id, clampedValue);
        }
        renderCart();
    });

    return input;
}

function renderCart() {
    const cartContainer = document.getElementById('shop-cart-items');
    if (!cartContainer) return;

    const cartEntries = getCartEntries();
    cartContainer.innerHTML = '';

    if (!cartEntries.length) {
        const emptyState = document.createElement('p');
        emptyState.className = 'shop-cart-empty';
        emptyState.textContent = 'Your cart is empty. Add a product to continue.';
        cartContainer.appendChild(emptyState);
        updateTotals();
        renderProducts();
        return;
    }

    cartEntries.forEach(({ product, quantity, lineTotal }) => {
        const row = document.createElement('article');
        row.className = 'shop-cart-row';

        const details = document.createElement('div');
        details.className = 'shop-cart-details';

        const name = document.createElement('h4');
        name.textContent = product.name;

        const price = document.createElement('p');
        price.textContent = `${formatCurrency(product.price)} each`;

        const availability = document.createElement('p');
        const availabilityText = getAvailabilityText(product);
        details.append(name, price);
        if (availabilityText) {
            availability.className = 'shop-item-availability';
            availability.textContent = availabilityText;
            details.appendChild(availability);
        }

        const controls = document.createElement('div');
        controls.className = 'shop-cart-controls';

        const quantityInput = createQuantityInput(product, quantity);

        const lineTotalElement = document.createElement('span');
        lineTotalElement.className = 'shop-line-total';
        lineTotalElement.textContent = formatCurrency(lineTotal);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'shop-remove-btn';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            shopState.cart.delete(product.id);
            shopState.ticketDates.delete(product.id);
            clearEventAvailabilityForProduct(product.id);
            clearEventCalendarForProduct(product.id);
            closeTicketDateModal();
            renderCart();
        });

        controls.append(quantityInput, lineTotalElement, removeButton);

        row.append(details, controls);
        cartContainer.appendChild(row);
    });

    updateTotals();
    renderProducts();
}

async function addToCart(productId) {
    if (shopState.isCheckoutComplete) {
        setFormMessage('Start a new order before adding more items.', 'warning');
        return;
    }

    const product = shopState.products.find((item) => item.id === productId);
    if (!product) return;
    if (product.isHidden || isRoundingProductName(product.name)) return;

    if (requiresVisitDate(product)) {
        await openTicketDateModal(product);
        return;
    }

    const remainingQuantity = getRemainingQuantity(product);
    if (remainingQuantity <= 0) {
        setFormMessage(isTicketProduct(product) ? 'This ticket is fully booked.' : 'This item is out of stock.', 'warning');
        renderProducts();
        return;
    }

    const existingQuantity = shopState.cart.get(productId) || 0;
    shopState.cart.set(productId, existingQuantity + 1);

    setFormMessage('Item added to cart.', 'success');
    renderCart();
}

function createProductCard(product) {
    const card = document.createElement('article');
    card.className = 'shop-product-card';

    const title = document.createElement('h3');
    title.textContent = product.name;

    const description = document.createElement('p');
    description.textContent = product.description;

    const inventory = document.createElement('span');
    const availabilityText = getAvailabilityText(product);
    if (availabilityText) {
        inventory.className = 'shop-product-inventory';
        inventory.textContent = availabilityText;
    }

    const footer = document.createElement('div');
    footer.className = 'shop-product-footer';

    const price = document.createElement('strong');
    price.textContent = formatCurrency(product.price);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'shop-add-btn';

    const remainingQuantity = getRemainingQuantity(product);
    addButton.textContent = remainingQuantity <= 0 ? (isTicketProduct(product) ? 'Fully Booked' : 'Sold Out') : 'Add to Cart';
    addButton.disabled = remainingQuantity <= 0 || shopState.isCheckoutComplete;
    addButton.addEventListener('click', () => addToCart(product.id));

    footer.append(price, addButton);
    card.append(title, description);
    if (availabilityText) {
        card.appendChild(inventory);
    }
    card.appendChild(footer);
    return card;
}

function getProductsByCategory(products) {
    const groupedProducts = new Map();

    products.forEach((product) => {
        const categoryName = String(product.category || '').trim() || 'General';
        if (!groupedProducts.has(categoryName)) {
            groupedProducts.set(categoryName, []);
        }
        groupedProducts.get(categoryName).push(product);
    });

    return groupedProducts;
}

function createProductCategorySection(categoryName, products) {
    const section = document.createElement('section');
    section.className = 'shop-category-section';

    const heading = document.createElement('h3');
    heading.className = 'shop-category-title';
    heading.textContent = categoryName;

    const categoryGrid = document.createElement('div');
    categoryGrid.className = 'shop-category-grid';

    products.forEach((product) => {
        categoryGrid.appendChild(createProductCard(product));
    });

    section.append(heading, categoryGrid);
    return section;
}

function renderProducts() {
    const productGrid = document.getElementById('shop-product-grid');
    if (!productGrid) return;

    productGrid.innerHTML = '';

    const visibleProducts = shopState.products.filter((product) => {
        return !product.isHidden && !isRoundingProductName(product.name);
    });

    if (!visibleProducts.length) {
        const errorState = document.createElement('p');
        errorState.className = 'shop-products-empty';
        errorState.textContent = 'Products are unavailable right now. Please refresh and try again.';
        productGrid.appendChild(errorState);
        return;
    }

    const productsByCategory = getProductsByCategory(visibleProducts);
    productsByCategory.forEach((products, categoryName) => {
        if (!products.length) return;
        productGrid.appendChild(createProductCategorySection(categoryName, products));
    });
}

function normalizeCardNumber(rawValue) {
    const digits = rawValue.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function handleCardFormatting(form) {
    const cardInput = form.querySelector('input[name="cardNumber"]');
    if (!cardInput) return;

    cardInput.addEventListener('input', () => {
        cardInput.value = normalizeCardNumber(cardInput.value);
    });
}

function validateCheckoutForm(form) {
    const requiredFields = ['fullName', 'email', 'shippingAddress', 'city', 'postalCode', 'cardNumber'];
    const values = Object.fromEntries(new FormData(form).entries());

    for (const fieldName of requiredFields) {
        if (!String(values[fieldName] || '').trim()) {
            return `Please complete ${fieldName.replace(/([A-Z])/g, ' $1').toLowerCase()}.`;
        }
    }

    if (!String(values.email).includes('@')) {
        return 'Please provide a valid email address.';
    }

    const cardDigits = String(values.cardNumber).replace(/\D/g, '');
    if (cardDigits.length < 12) {
        return 'Please enter a valid card number for this mock checkout.';
    }

    const invalidInventory = getCartEntries().find(({ product, quantity }) => {
        if (requiresVisitDate(product)) {
            return false;
        }
        const inventoryLimit = getInventoryLimit(product);
        if (!Number.isFinite(inventoryLimit)) {
            return false;
        }
        return quantity > inventoryLimit || inventoryLimit <= 0;
    });

    if (invalidInventory) {
        return `Not enough availability for ${invalidInventory.product.name}. Update your cart quantities.`;
    }

    const missingTicketDate = getCartEntries().find(({ product }) => {
        return requiresVisitDate(product) && !getTicketDate(product.id);
    });

    if (missingTicketDate) {
        return `Select a visit date for ${missingTicketDate.product.name}.`;
    }

    return null;
}

function resetCheckoutForm(form) {
    form.reset();
}

async function applyOrderInventoryReduction() {
    const client = getSupabaseClient();
    const cartEntries = getCartEntries();

    for (const { product, quantity } of cartEntries) {
        if (requiresVisitDate(product)) {
            const visitDate = getTicketDate(product.id);
            if (!visitDate) {
                throw new Error(`Select a visit date for ${product.name}.`);
            }

            const calendarMap = await preloadEventCalendar(product, { force: true });
            const selectedEvent = calendarMap.get(visitDate) || null;
            if (!selectedEvent || !selectedEvent.id) {
                throw new Error(`No event is scheduled for ${product.name} on ${visitDate}.`);
            }

            const { data: currentEventRow, error: readEventError } = await client
                .from(EVENTS_TABLE)
                .select('*')
                .eq('id', selectedEvent.id)
                .maybeSingle();

            if (readEventError) {
                throw new Error(`Could not verify event capacity for ${product.name}: ${readEventError.message}`);
            }

            if (!currentEventRow) {
                throw new Error(`Event data changed for ${product.name} on ${visitDate}. Please reselect a date.`);
            }

            let normalizedEvent = normalizeEventAvailabilityRow(currentEventRow);
            if (!normalizedEvent) {
                throw new Error(`Event data is invalid for ${product.name} on ${visitDate}.`);
            }

            if (Number.isFinite(normalizedEvent.remaining) && normalizedEvent.remaining < quantity) {
                throw new Error(`Not enough spots for ${product.name} on ${visitDate}. Available: ${normalizedEvent.remaining}.`);
            }

            if (!isUnlimitedInventoryValue(normalizedEvent.capacity)) {
                let updatedAvailability = null;

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    if (Number.isFinite(normalizedEvent.remaining) && normalizedEvent.remaining < quantity) {
                        throw new Error(`Not enough spots for ${product.name} on ${visitDate}. Available: ${normalizedEvent.remaining}.`);
                    }

                    const nextSpotsPurchased = normalizedEvent.spotsPurchased + quantity;
                    if (nextSpotsPurchased > normalizedEvent.capacity) {
                        throw new Error(`Requested quantity exceeds capacity for ${product.name} on ${visitDate}.`);
                    }

                    const { data: updatedEventRows, error: updateEventError } = await client
                        .from(EVENTS_TABLE)
                        .update({ spots_purchased: nextSpotsPurchased })
                        .eq('id', normalizedEvent.id)
                        .eq('spots_purchased', normalizedEvent.spotsPurchased)
                        .select('*');

                    if (updateEventError) {
                        throw new Error(`Could not update event capacity for ${product.name}: ${updateEventError.message}`);
                    }

                    const updatedEventRow = Array.isArray(updatedEventRows) && updatedEventRows.length
                        ? updatedEventRows[0]
                        : null;

                    if (updatedEventRow) {
                        updatedAvailability = normalizeEventAvailabilityRow(updatedEventRow);
                        if (!updatedAvailability) {
                            throw new Error(`Event data was invalid after update for ${product.name} on ${visitDate}.`);
                        }
                        break;
                    }

                    const { data: refreshedEventRow, error: refreshEventError } = await client
                        .from(EVENTS_TABLE)
                        .select('*')
                        .eq('id', normalizedEvent.id)
                        .maybeSingle();

                    if (refreshEventError) {
                        throw new Error(`Could not refresh event capacity for ${product.name}: ${refreshEventError.message}`);
                    }

                    const refreshedEvent = normalizeEventAvailabilityRow(refreshedEventRow);
                    if (!refreshedEvent) {
                        throw new Error(`Event data changed for ${product.name} on ${visitDate}. Please reselect a date.`);
                    }

                    normalizedEvent = refreshedEvent;
                }

                if (!updatedAvailability) {
                    throw new Error(`Availability changed for ${product.name} on ${visitDate} while checking out. Please try again.`);
                }

                const eventKey = getEventAvailabilityKey(product.id, visitDate);
                shopState.eventAvailability.set(eventKey, updatedAvailability);
            }

            continue;
        }

        const { data: currentRow, error: readError } = await client
            .from(SHOP_PRODUCTS_TABLE)
            .select('id, stock')
            .eq('id', product.id)
            .maybeSingle();

        if (readError) {
            throw new Error(`Could not verify stock for ${product.name}: ${readError.message}`);
        }

        if (!currentRow) {
            throw new Error(`Product ${product.name} is no longer available.`);
        }

        const currentStock = Number(currentRow.stock);
        if (!Number.isFinite(currentStock)) {
            throw new Error(`Product ${product.name} has invalid stock data.`);
        }

        if (isUnlimitedInventoryValue(currentStock)) {
            product.stock = -1;
            continue;
        }

        if (currentStock < quantity) {
            throw new Error(`Not enough stock for ${product.name}. Available: ${Math.max(0, Math.floor(currentStock))}.`);
        }

        const nextStock = Math.max(0, Math.floor(currentStock - quantity));
        const { data: updatedRow, error: updateError } = await client
            .from(SHOP_PRODUCTS_TABLE)
            .update({ stock: nextStock })
            .eq('id', product.id)
            .eq('stock', currentStock)
            .select('id, stock')
            .maybeSingle();

        if (updateError) {
            throw new Error(`Could not update stock for ${product.name}: ${updateError.message}`);
        }

        if (!updatedRow) {
            throw new Error(`Stock changed for ${product.name} while checking out. Please try again.`);
        }

        product.stock = nextStock;
    }
}

function startNewOrder() {
    shopState.isCheckoutComplete = false;
    shopState.ticketDates.clear();
    shopState.eventAvailability.clear();
    shopState.eventCalendarByProduct.clear();
    closeTicketDateModal();
    clearAppliedPromotion();
    const form = getCheckoutForm();
    if (form) {
        form.reset();
    }
    setPromoMessage('');
    setCheckoutInputsDisabled(false);
    setFormMessage('New order started. Add items to your cart to check out again.', 'success');
    renderCart();
}

function attachCheckoutHandler() {
    const form = document.getElementById('shop-checkout-form');
    if (!form) return;

    if (form.dataset.initialized === 'true') return;
    form.dataset.initialized = 'true';

    handleCardFormatting(form);

    const roundToggle = document.getElementById('shop-round-toggle');
    if (roundToggle) {
        roundToggle.addEventListener('change', () => {
            syncRoundPreference();
            updateTotals();
        });
    }

    const promotionInput = getPromotionCodeInput();
    if (promotionInput) {
        promotionInput.addEventListener('input', () => {
            updatePromotionActionState();
        });
    }

    const applyPromotionButton = getApplyPromotionButton();
    if (applyPromotionButton) {
        applyPromotionButton.addEventListener('click', handleApplyPromotion);
    }

    const removePromotionButton = getRemovePromotionButton();
    if (removePromotionButton) {
        removePromotionButton.addEventListener('click', handleRemovePromotion);
    }

    const startNewOrderButton = getStartNewOrderButton();
    if (startNewOrderButton) {
        startNewOrderButton.addEventListener('click', startNewOrder);
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (shopState.isCheckoutComplete) {
            setFormMessage('This order has already been placed.', 'warning');
            return;
        }

        if (getCartSubtotal() <= 0) {
            setFormMessage('Add at least one item to your cart before checking out.', 'warning');
            return;
        }

        const errorMessage = validateCheckoutForm(form);
        if (errorMessage) {
            setFormMessage(errorMessage, 'error');
            return;
        }

        const formValues = Object.fromEntries(new FormData(form).entries());
        const cartEntries = getCartEntries();
        const transactionId = createTransactionId();
        const contactDetails = {
            name: String(formValues.fullName || '').trim(),
            email: String(formValues.email || '').trim(),
            shippingAddress: String(formValues.shippingAddress || '').trim(),
            city: String(formValues.city || '').trim(),
            postalCode: String(formValues.postalCode || '').trim(),
            roundingProductId: '',
            roundingAdjustment: 0
        };

        if (shopState.roundToNearestDollar) {
            const roundingProduct = await getRoundingProduct();
            if (!roundingProduct) {
                setFormMessage('Rounding product is missing from products. Add a product named "Rounding" to continue with rounding.', 'error');
                if (placeOrderButton) {
                    placeOrderButton.disabled = false;
                    delete placeOrderButton.dataset.pending;
                }
                return;
            }

            const subtotal = getCartSubtotal();
            const basePricingSummary = getPricingSummary(subtotal, false, 0);
            const promotionDiscountAmount = getPromotionDiscountAmount(basePricingSummary.total);
            const pricingSummary = getPricingSummary(subtotal, true, promotionDiscountAmount);
            contactDetails.roundingProductId = roundingProduct.id;
            contactDetails.roundingAdjustment = pricingSummary.roundingAdjustment;
        }

        const placeOrderButton = document.getElementById('shop-place-order');
        if (placeOrderButton) {
            placeOrderButton.disabled = true;
            placeOrderButton.dataset.pending = 'true';
        }

        setFormMessage('Processing order...', 'neutral');

        let inventoryError = null;
        let transactionStatus = 0;

        try {
            await applyOrderInventoryReduction();
            transactionStatus = 1;
        } catch (error) {
            inventoryError = error;
            console.error(error);
        }

        const transactionRows = createTransactionRows(transactionId, contactDetails, cartEntries, transactionStatus);
        let transactionRowsInserted = false;
        try {
            await insertTransactionRows(transactionRows);
            transactionRowsInserted = true;
        } catch (transactionError) {
            console.error(transactionError);
        }

        if (transactionRowsInserted) {
            const visitDateRows = createVisitDateRows(transactionId, contactDetails.name, cartEntries);
            try {
                await insertVisitDateRows(visitDateRows);
            } catch (visitDateError) {
                console.error(visitDateError);
            }
        }

        if (placeOrderButton) {
            delete placeOrderButton.dataset.pending;
        }

        if (inventoryError) {
            setFormMessage(inventoryError.message || 'Could not complete checkout due to a stock update issue.', 'error');
            renderCart();
            return;
        }

        shopState.isCheckoutComplete = true;
        shopState.cart.clear();
        shopState.ticketDates.clear();
        shopState.eventAvailability.clear();
        shopState.eventCalendarByProduct.clear();
        clearAppliedPromotion();
        setPromoMessage('');
        setCheckoutInputsDisabled(true);
        resetCheckoutForm(form);
        setFormMessage('Order placed successfully. This was a mock checkout.', 'success');
        renderCart();
    });
}

async function loadProducts() {
    const client = getSupabaseClient();

    const { data, error } = await client
        .from(SHOP_PRODUCTS_TABLE)
        .select('id, product_name, category, description, unit_price, stock, is_hidden, show_capacity')
        .order('unit_price', { ascending: true })
        .order('product_name', { ascending: true });

    if (error) {
        throw new Error(`Failed to load Supabase products: ${error.message}`);
    }

    if (!Array.isArray(data)) {
        throw new Error('Supabase products response was not an array.');
    }

    return mapProductsResponseRows(data);
}

function mapProductsResponseRows(rows) {
    if (!Array.isArray(rows)) return [];

    return rows
        .map((row) => {
            const id = String(row.id || '').trim();
            const name = String(row.product_name || '').trim();
            const category = String(row.category || '').trim() || 'General';
            const description = String(row.description || '').trim() || 'No description available.';
            const price = Number(row.unit_price);
            const stock = Number(row.stock);
            const isHidden = Boolean(row.is_hidden);
            const showCapacity = toBoolean(row.show_capacity, true);
            const isRoundingProduct = isRoundingProductName(name);

            if (!id || !name || (!isRoundingProduct && (!Number.isFinite(price) || !Number.isFinite(stock)))) {
                const missingFields = [];
                if (!id) missingFields.push('id');
                if (!name) missingFields.push('product_name');
                if (!isRoundingProduct && !Number.isFinite(price)) missingFields.push('unit_price');
                if (!isRoundingProduct && !Number.isFinite(stock)) missingFields.push('stock');
                console.warn(`Skipping invalid product row. Missing/invalid fields: ${missingFields.join(', ')}`, row);
                return null;
            }

            const mappedProduct = {
                id,
                name,
                category,
                description,
                price: Number.isFinite(price) ? price : 0,
                stock: Number.isFinite(stock)
                    ? (isUnlimitedInventoryValue(stock) ? -1 : Math.max(0, Math.floor(stock)))
                    : -1,
                capacity: Number.isFinite(stock)
                    ? (isUnlimitedInventoryValue(stock) ? -1 : Math.max(0, Math.floor(stock)))
                    : -1,
                showCapacity,
                isHidden
            };

            console.debug('[shop] show_capacity mapping', {
                id: mappedProduct.id,
                name: mappedProduct.name,
                show_capacity: row.show_capacity,
                showCapacity: mappedProduct.showCapacity
            });

            return mappedProduct;
        })
        .filter(Boolean);
}

function readCachedProducts() {
    try {
        const rawTimestamp = Number(sessionStorage.getItem(SHOP_PRODUCTS_CACHE_TIME_KEY));
        if (!Number.isFinite(rawTimestamp) || rawTimestamp <= 0) return [];

        if (Date.now() - rawTimestamp > SHOP_PRODUCTS_CACHE_TTL_MS) {
            return [];
        }

        const rawProducts = sessionStorage.getItem(SHOP_PRODUCTS_CACHE_KEY);
        if (!rawProducts) return [];

        const parsedRows = JSON.parse(rawProducts);
        return mapProductsResponseRows(parsedRows);
    } catch {
        return [];
    }
}

function writeCachedProducts(products) {
    try {
        const rowsForCache = products.map((product) => ({
            id: product.id,
            product_name: product.name,
            category: product.category,
            description: product.description,
            unit_price: product.price,
            stock: product.stock,
            show_capacity: toBoolean(product.showCapacity, true),
            is_hidden: Boolean(product.isHidden)
        }));

        sessionStorage.setItem(SHOP_PRODUCTS_CACHE_KEY, JSON.stringify(rowsForCache));
        sessionStorage.setItem(SHOP_PRODUCTS_CACHE_TIME_KEY, String(Date.now()));
    } catch {
        // no-op when storage is unavailable
    }
}

function setProductsLoadError() {
    const productGrid = document.getElementById('shop-product-grid');
    if (productGrid) {
        productGrid.innerHTML = '<p class="shop-products-empty">Could not load products. Please try again later.</p>';
    }
}

async function initializeShopPage() {
    const productGrid = document.getElementById('shop-product-grid');
    if (!productGrid) return;

    shopState.products = [];
    shopState.cart = new Map();
    shopState.ticketDates = new Map();
    shopState.eventAvailability = new Map();
    shopState.eventCalendarByProduct = new Map();
    shopState.roundToNearestDollar = false;
    shopState.appliedPromotion = null;
    shopState.isCheckoutComplete = false;
    setPromoMessage('');
    setCheckoutInputsDisabled(false);
    updateCheckoutActionState();
    ensureTicketDateModal();

    const cachedProducts = readCachedProducts();
    if (cachedProducts.length) {
        shopState.products = cachedProducts;
        renderProducts();
        setFormMessage('Products loaded. Add items to your cart to begin checkout.');
    } else {
        productGrid.innerHTML = '<p class="shop-products-empty">Loading products...</p>';
    }
    attachCheckoutHandler();
    renderCart();

    try {
        const loadedProducts = await loadProducts();
        shopState.products = loadedProducts;
        writeCachedProducts(loadedProducts);
        renderProducts();
        renderCart();
        setFormMessage('Add items to your cart to begin checkout.');
    } catch (error) {
        console.error(error);
        if (shopState.products.length) {
            renderProducts();
            renderCart();
            setFormMessage('Using cached products. Live updates are temporarily unavailable.', 'warning');
            return;
        }

        shopState.products = [];
        shopState.cart.clear();
        shopState.ticketDates.clear();
        shopState.eventAvailability.clear();
        shopState.eventCalendarByProduct.clear();
        setProductsLoadError();
        setCheckoutInputsDisabled(true);
        setFormMessage('Checkout is unavailable until products load.', 'error');
    }
}

window.initializeShopPage = initializeShopPage;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeShopPage);
} else {
    initializeShopPage();
}
