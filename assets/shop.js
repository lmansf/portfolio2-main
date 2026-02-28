const SHOP_PRODUCT_SOURCE = 'assets/data/products.json';

const shopState = {
    products: [],
    cart: new Map(),
    isCheckoutComplete: false
};

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

function createQuantityInput(productId, quantity) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = String(quantity);
    input.className = 'shop-quantity-input';
    input.setAttribute('aria-label', 'Quantity');
    input.addEventListener('change', () => {
        const parsedValue = Number.parseInt(input.value, 10);
        if (!Number.isFinite(parsedValue) || parsedValue < 1) {
            shopState.cart.delete(productId);
        } else {
            shopState.cart.set(productId, parsedValue);
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

        details.append(name, price);

        const controls = document.createElement('div');
        controls.className = 'shop-cart-controls';

        const quantityInput = createQuantityInput(product.id, quantity);

        const lineTotalElement = document.createElement('span');
        lineTotalElement.className = 'shop-line-total';
        lineTotalElement.textContent = formatCurrency(lineTotal);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'shop-remove-btn';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            shopState.cart.delete(product.id);
            renderCart();
        });

        controls.append(quantityInput, lineTotalElement, removeButton);
        row.append(details, controls);
        cartContainer.appendChild(row);
    });

    updateTotals();
}

function addToCart(productId) {
    if (shopState.isCheckoutComplete) {
        setFormMessage('Start a new order before adding more items.', 'warning');
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

    const footer = document.createElement('div');
    footer.className = 'shop-product-footer';

    const price = document.createElement('strong');
    price.textContent = formatCurrency(product.price);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'shop-add-btn';
    addButton.textContent = 'Add to Cart';
    addButton.addEventListener('click', () => addToCart(product.id));

    footer.append(price, addButton);
    card.append(category, title, description, footer);
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

    return null;
}

function resetCheckoutForm(form) {
    form.reset();
}

function startNewOrder() {
    shopState.isCheckoutComplete = false;
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
        shopState.cart.clear();
        setCheckoutInputsDisabled(true);
        resetCheckoutForm(form);
        setFormMessage('Order placed successfully. This was a mock checkout.', 'success');
        renderCart();
    });
}

async function loadProducts() {
    const response = await fetch(SHOP_PRODUCT_SOURCE, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to load catalog (${response.status})`);
    }

    const products = await response.json();
    if (!Array.isArray(products)) {
        throw new Error('Invalid product catalog format.');
    }

    return products;
}

async function initializeShopPage() {
    const productGrid = document.getElementById('shop-product-grid');
    if (!productGrid) return;

    shopState.products = [];
    shopState.cart = new Map();
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
