const SUPABASE_URL = 'https://xcubnwvyvhjfyiixunfg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_K5k9vLXtDUo8qoyWrwX3qg_qN_3xWfy';
const SHOP_PRODUCTS_TABLE = 'products';
const TRANSACTIONS_TABLE = 'transactions';
const PROMOTIONS_TABLE = 'promotions';
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

function isTicketProduct(product) {
    if (!product) return false;
    const category = String(product.category || '').toLowerCase();
    const name = String(product.name || '').toLowerCase();
    return category === 'experience' || category === 'education' || /ticket|pass|workshop|tour/.test(name);
}

function requiresVisitDate(product) {
    if (!product) return false;
    const category = String(product.category || '').toLowerCase();
    const name = String(product.name || '').toLowerCase();
    return category === 'experience' || /ticket|tour|workshop/.test(name);
}

function getInventoryLimit(product) {
    if (!product) return 0;
    const sourceValue = isTicketProduct(product) ? product.capacity : product.stock;
    const parsedValue = Number(sourceValue);
    if (!Number.isFinite(parsedValue)) return 0;
    return Math.max(0, Math.floor(parsedValue));
}

function setInventoryLimit(product, nextValue) {
    if (!product) return;
    const sanitizedValue = Math.max(0, Math.floor(Number(nextValue) || 0));
    if (isTicketProduct(product)) {
        product.capacity = sanitizedValue;
        return;
    }
    product.stock = sanitizedValue;
}

function getRemainingQuantity(product) {
    const inventoryLimit = getInventoryLimit(product);
    const quantityInCart = shopState.cart.get(product.id) || 0;
    return Math.max(0, inventoryLimit - quantityInCart);
}

function getAvailabilityText(product) {
    const remaining = getRemainingQuantity(product);
    return isTicketProduct(product) ? `${remaining} spots left` : `${remaining} in stock`;
}

function getTicketDate(productId) {
    return shopState.ticketDates.get(productId) || '';
}

function setTicketDate(productId, value) {
    if (!value) {
        shopState.ticketDates.delete(productId);
        return;
    }
    shopState.ticketDates.set(productId, value);
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

    return cartEntries.map(({ product, quantity }) => ({
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

function createQuantityInput(product, quantity) {
    const maxQuantity = getInventoryLimit(product);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(maxQuantity);
    input.step = '1';
    input.value = String(quantity);
    input.className = 'shop-quantity-input';
    input.setAttribute('aria-label', 'Quantity');
    input.addEventListener('change', () => {
        const parsedValue = Number.parseInt(input.value, 10);

        if (!Number.isFinite(parsedValue) || parsedValue < 1) {
            shopState.cart.delete(product.id);
            shopState.ticketDates.delete(product.id);
            renderCart();
            return;
        }

        const clampedValue = Math.min(parsedValue, maxQuantity);
        if (clampedValue <= 0) {
            shopState.cart.delete(product.id);
            shopState.ticketDates.delete(product.id);
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
        availability.className = 'shop-item-availability';
        availability.textContent = getAvailabilityText(product);

        details.append(name, price, availability);

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
            renderCart();
        });

        controls.append(quantityInput, lineTotalElement, removeButton);

        if (requiresVisitDate(product)) {
            const dateWrapper = document.createElement('label');
            dateWrapper.className = 'shop-ticket-date-label';
            dateWrapper.textContent = 'Visit Date';

            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.className = 'shop-ticket-date-input';
            dateInput.min = getTodayIsoDate();
            dateInput.value = getTicketDate(product.id);
            dateInput.addEventListener('change', () => {
                setTicketDate(product.id, dateInput.value);
                setFormMessage('');
            });

            dateWrapper.appendChild(dateInput);
            details.appendChild(dateWrapper);
        }

        row.append(details, controls);
        cartContainer.appendChild(row);
    });

    updateTotals();
    renderProducts();
}

function addToCart(productId) {
    if (shopState.isCheckoutComplete) {
        setFormMessage('Start a new order before adding more items.', 'warning');
        return;
    }

    const product = shopState.products.find((item) => item.id === productId);
    if (!product) return;

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
    inventory.className = 'shop-product-inventory';
    inventory.textContent = getAvailabilityText(product);

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
    card.append(title, description, inventory, footer);
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

    if (!shopState.products.length) {
        const errorState = document.createElement('p');
        errorState.className = 'shop-products-empty';
        errorState.textContent = 'Products are unavailable right now. Please refresh and try again.';
        productGrid.appendChild(errorState);
        return;
    }

    const productsByCategory = getProductsByCategory(shopState.products);
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
        return quantity > getInventoryLimit(product) || getInventoryLimit(product) <= 0;
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
        product.capacity = nextStock;
    }
}

function startNewOrder() {
    shopState.isCheckoutComplete = false;
    shopState.ticketDates.clear();
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
            postalCode: String(formValues.postalCode || '').trim()
        };

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
        try {
            await insertTransactionRows(transactionRows);
        } catch (transactionError) {
            console.error(transactionError);
        } finally {
            if (placeOrderButton) {
                delete placeOrderButton.dataset.pending;
            }
        }

        if (inventoryError) {
            setFormMessage(inventoryError.message || 'Could not complete checkout due to a stock update issue.', 'error');
            renderCart();
            return;
        }

        shopState.isCheckoutComplete = true;
        shopState.cart.clear();
        shopState.ticketDates.clear();
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
        .select('id, product_name, category, description, unit_price, stock')
        .order('unit_price', { ascending: true })
        .order('product_name', { ascending: true });

    if (error) {
        throw new Error(`Failed to load Supabase products: ${error.message}`);
    }

    if (!Array.isArray(data)) {
        throw new Error('Supabase products response was not an array.');
    }

    return data
        .map((row) => {
            const id = String(row.id || '').trim();
            const name = String(row.product_name || '').trim();
            const category = String(row.category || '').trim() || 'General';
            const description = String(row.description || '').trim() || 'No description available.';
            const price = Number(row.unit_price);
            const stock = Number(row.stock);

            if (!id || !name || !Number.isFinite(price) || !Number.isFinite(stock)) {
                const missingFields = [];
                if (!id) missingFields.push('id');
                if (!name) missingFields.push('product_name');
                if (!Number.isFinite(price)) missingFields.push('unit_price');
                if (!Number.isFinite(stock)) missingFields.push('stock');
                console.warn(`Skipping invalid product row. Missing/invalid fields: ${missingFields.join(', ')}`, row);
                return null;
            }

            const mappedProduct = {
                id,
                name,
                category,
                description,
                price,
                stock: Math.max(0, Math.floor(stock)),
                capacity: Math.max(0, Math.floor(stock))
            };

            return mappedProduct;
        })
        .filter(Boolean);
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
    shopState.roundToNearestDollar = false;
    shopState.appliedPromotion = null;
    shopState.isCheckoutComplete = false;
    setPromoMessage('');
    setCheckoutInputsDisabled(false);
    updateCheckoutActionState();

    productGrid.innerHTML = '<p class="shop-products-empty">Loading products...</p>';

    try {
        shopState.products = await loadProducts();
        renderProducts();
        renderCart();
        attachCheckoutHandler();
        setFormMessage('Add items to your cart to begin checkout.');
    } catch (error) {
        console.error(error);
        shopState.products = [];
        shopState.cart.clear();
        shopState.ticketDates.clear();
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
