const SUPABASE_URL = 'https://xcubnwvyvhjfyiixunfg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_K5k9vLXtDUo8qoyWrwX3qg_qN_3xWfy';
const SHOP_PRODUCTS_TABLE = 'products';
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
    isCheckoutComplete: false
};

function formatSignedCurrency(value) {
    const absoluteAmount = formatCurrency(Math.abs(value));
    if (value > 0) return `+${absoluteAmount}`;
    if (value < 0) return `-${absoluteAmount}`;
    return absoluteAmount;
}

function getPricingSummary(subtotal, shouldRound) {
    const tax = subtotal > 0 ? subtotal * SALES_TAX_RATE : 0;
    const serviceFee = subtotal > 0 ? SERVICE_FEE : 0;
    const preRoundTotal = subtotal + tax + serviceFee;
    const total = shouldRound ? Math.round(preRoundTotal) : preRoundTotal;
    const roundingAdjustment = shouldRound ? total - preRoundTotal : 0;

    return {
        subtotal,
        tax,
        serviceFee,
        roundingAdjustment,
        total
    };
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

function updateTotals() {
    const subtotal = getCartSubtotal();
    const pricingSummary = getPricingSummary(subtotal, shopState.roundToNearestDollar);

    const subtotalElement = document.getElementById('shop-subtotal');
    const taxElement = document.getElementById('shop-tax');
    const serviceFeeElement = document.getElementById('shop-service-fee');
    const roundingRowElement = document.getElementById('shop-rounding-row');
    const roundingElement = document.getElementById('shop-rounding');
    const roundingHelpElement = document.getElementById('shop-rounding-help');
    const totalElement = document.getElementById('shop-total');

    if (subtotalElement) subtotalElement.textContent = formatCurrency(pricingSummary.subtotal);
    if (taxElement) taxElement.textContent = formatCurrency(pricingSummary.tax);
    if (serviceFeeElement) serviceFeeElement.textContent = formatCurrency(pricingSummary.serviceFee);
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
            const roundedPreview = getPricingSummary(subtotal, true);
            roundingHelpElement.textContent = `If enabled now, adjustment would be ${formatSignedCurrency(roundedPreview.roundingAdjustment)}.`;
        }
    }

    if (totalElement) totalElement.textContent = formatCurrency(pricingSummary.total);

    const placeOrderButton = document.getElementById('shop-place-order');
    if (placeOrderButton) {
        placeOrderButton.disabled = subtotal <= 0 || shopState.isCheckoutComplete;
    }

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

    const category = document.createElement('span');
    category.className = 'shop-product-category';
    category.textContent = product.category;

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
    card.append(category, title, description, inventory, footer);
    return card;
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

    shopState.products.forEach((product) => {
        productGrid.appendChild(createProductCard(product));
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
    const form = getCheckoutForm();
    if (form) {
        form.reset();
    }
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

        const placeOrderButton = document.getElementById('shop-place-order');
        if (placeOrderButton) {
            placeOrderButton.disabled = true;
            placeOrderButton.dataset.pending = 'true';
        }

        setFormMessage('Processing order...', 'neutral');

        try {
            await applyOrderInventoryReduction();
        } catch (inventoryError) {
            console.error(inventoryError);
            setFormMessage(inventoryError.message || 'Could not complete checkout due to a stock update issue.', 'error');
            renderCart();
            return;
        } finally {
            if (placeOrderButton) {
                delete placeOrderButton.dataset.pending;
            }
        }

        shopState.isCheckoutComplete = true;
        shopState.cart.clear();
        shopState.ticketDates.clear();
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
    shopState.isCheckoutComplete = false;
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
