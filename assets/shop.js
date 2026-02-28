const SHOP_PRODUCT_SOURCE = 'assets/data/products.json';
const SHOP_FALLBACK_PRODUCTS = [
    {
        id: 'owl-adoption-plush',
        name: 'Adopt-an-Owl Plush',
        description: 'Soft rescue owl plush with a name tag from the nocturnal aviary.',
        price: 24.95,
        category: 'Gift Shop',
        stock: 28
    },
    {
        id: 'moonlight-owl-tour',
        name: 'Moonlight Owl Walk Ticket',
        description: 'After-hours guided tour through the owl habitat and rehab observation deck.',
        price: 42.0,
        category: 'Experience',
        capacity: 16
    },
    {
        id: 'keeper-for-day-pass',
        name: 'Junior Keeper Pass',
        description: 'Hands-on educational session assisting keepers with owl enrichment setup.',
        price: 79.0,
        category: 'Education',
        capacity: 10
    },
    {
        id: 'owl-cafe-combo',
        name: 'Owl Cafe Snack Bundle',
        description: 'Facility cafe combo with hot cocoa, themed pastry, and souvenir cup.',
        price: 18.5,
        category: 'Cafe',
        stock: 35
    },
    {
        id: 'night-vision-binocular-rental',
        name: 'Night Vision Binocular Rental',
        description: 'Two-hour rental for dusk feeding demos and owl flight observation.',
        price: 16.0,
        category: 'Rental',
        stock: 12
    },
    {
        id: 'owl-habitat-donation',
        name: 'Habitat Restoration Donation',
        description: 'Contribute directly to enclosure upgrades and medical care supplies.',
        price: 25.0,
        category: 'Support',
        stock: 999
    },
    {
        id: 'owl-feather-journal',
        name: 'Field Notes Journal',
        description: 'Recycled paper journal inspired by owl tracking logs used by staff.',
        price: 14.75,
        category: 'Gift Shop',
        stock: 40
    },
    {
        id: 'kids-owl-workshop',
        name: 'Kids Owl Discovery Workshop',
        description: 'Weekend workshop with interactive stations, pellets lab, and storytelling.',
        price: 29.0,
        category: 'Education',
        capacity: 14
    }
];

const shopState = {
    products: [],
    cart: new Map(),
    ticketDates: new Map(),
    isCheckoutComplete: false
};

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
    const subtotalElement = document.getElementById('shop-subtotal');
    const totalElement = document.getElementById('shop-total');

    if (subtotalElement) subtotalElement.textContent = formatCurrency(subtotal);
    if (totalElement) totalElement.textContent = formatCurrency(subtotal);

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

        if (isTicketProduct(product)) {
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
        return isTicketProduct(product) && !getTicketDate(product.id);
    });

    if (missingTicketDate) {
        return `Select a visit date for ${missingTicketDate.product.name}.`;
    }

    return null;
}

function resetCheckoutForm(form) {
    form.reset();
}

function applyOrderInventoryReduction() {
    getCartEntries().forEach(({ product, quantity }) => {
        const currentLimit = getInventoryLimit(product);
        setInventoryLimit(product, currentLimit - quantity);
    });
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

    const startNewOrderButton = getStartNewOrderButton();
    if (startNewOrderButton) {
        startNewOrderButton.addEventListener('click', startNewOrder);
    }

    form.addEventListener('submit', (event) => {
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

        shopState.isCheckoutComplete = true;
        applyOrderInventoryReduction();
        shopState.cart.clear();
        shopState.ticketDates.clear();
        setCheckoutInputsDisabled(true);
        resetCheckoutForm(form);
        setFormMessage('Order placed successfully. This was a mock checkout.', 'success');
        renderCart();
    });
}

async function loadProducts() {
    try {
        const response = await fetch(SHOP_PRODUCT_SOURCE, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to load catalog (${response.status})`);
        }

        const products = await response.json();
        if (!Array.isArray(products)) {
            throw new Error('Invalid product catalog format.');
        }

        return products;
    } catch (error) {
        console.warn('Using fallback product catalog because JSON fetch failed.', error);
        return SHOP_FALLBACK_PRODUCTS;
    }
}

async function initializeShopPage() {
    const productGrid = document.getElementById('shop-product-grid');
    if (!productGrid) return;

    shopState.products = [];
    shopState.cart = new Map();
    shopState.ticketDates = new Map();
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
        productGrid.innerHTML = '<p class="shop-products-empty">Could not load products. Please try again later.</p>';
        setFormMessage('Checkout is unavailable until products load.', 'error');
    }
}

window.initializeShopPage = initializeShopPage;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeShopPage);
} else {
    initializeShopPage();
}
