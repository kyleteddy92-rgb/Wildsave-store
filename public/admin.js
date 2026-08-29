const state = {
  products: []
};

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Server returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

async function boot() {
  try {
    await api("/api/admin/me");
    showApp();
  } catch {
    // Stay on the login screen.
  }
}

async function login() {
  const username = $("user").value.trim();
  const password = $("pass").value;

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });

    showApp();
  } catch (error) {
    $("err").textContent = error.message;
  }
}

function showApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  dashboard();
}

async function logout() {
  try {
    await api("/api/admin/logout", {
      method: "POST"
    });
  } finally {
    location.reload();
  }
}

function tab(name) {
  ["dashboard", "products", "orders"].forEach(section => {
    $(section).classList.toggle("hidden", section !== name);
  });

  $("title").textContent =
    name.charAt(0).toUpperCase() + name.slice(1);

  if (name === "dashboard") dashboard();
  if (name === "products") loadProducts();
  if (name === "orders") loadOrders();
}

async function dashboard() {
  try {
    const stats = await api("/api/admin/dashboard");

    $("sp").textContent = stats.products ?? 0;
    $("so").textContent = stats.orders ?? 0;
    $("sc").textContent = stats.customers ?? 0;
    $("sr").textContent =
      "$" + Number(stats.revenue ?? 0).toFixed(2);
  } catch (error) {
    console.error(error);
  }
}

async function loadProducts() {
  try {
    state.products = await api("/api/admin/products");

    $("rows").innerHTML = state.products.map(product => `
      <tr>
        <td>${escapeHTML(product.name)}</td>
        <td>${escapeHTML(product.category)}</td>
        <td>$${Number(product.price).toFixed(2)}</td>
        <td>${product.stock}</td>
        <td>
          <button onclick="editProduct(${product.id})">Edit</button>
          <button onclick="deleteProduct(${product.id})">Delete</button>
        </td>
      </tr>
    `).join("");
  } catch (error) {
    alert(error.message);
  }
}

function openProduct(product = null) {
  $("pm").classList.add("open");

  $("pid").value = product?.id ?? "";
  $("pn").value = product?.name ?? "";
  $("pc").value = product?.category ?? "";
  $("pp").value = product?.price ?? "";
  $("ps").value = product?.stock ?? "";
  $("pi").value = product?.image ?? "";
  $("pd").value = product?.description ?? "";

  $("mt").textContent =
    product ? "Edit Product" : "Add Product";
}

function closeProduct() {
  $("pm").classList.remove("open");
}

function editProduct(id) {
  const product = state.products.find(
    item => item.id === id
  );

  if (product) openProduct(product);
}


async function uploadProductImage() {
  const fileInput = $("imageFile");
  const file = fileInput.files[0];

  if (!file) return $("pi").value || "";

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/admin/upload", {
    method: "POST",
    body: formData
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Image upload returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Image upload failed.");
  }

  return data.image;
}

async function saveProduct() {
  const id = $("pid").value;

  const image = await uploadProductImage();

    const product = {
    name: $("pn").value.trim(),
    category: $("pc").value.trim(),
    price: Number($("pp").value),
    stock: Number($("ps").value),
    image: image,
    description: $("pd").value.trim()
  };

  try {
    await api(
      id
        ? "/api/admin/products/" + id
        : "/api/admin/products",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(product)
      }
    );

    closeProduct();
    await loadProducts();
    await dashboard();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;

  try {
    await api("/api/admin/products/" + id, {
      method: "DELETE"
    });

    await loadProducts();
    await dashboard();
  } catch (error) {
    alert(error.message);
  }
}

async function loadOrders() {
  try {
    const orders = await api("/api/admin/orders");

    $("orows").innerHTML = orders.map(order => `
      <tr>
        <td>${escapeHTML(order.id)}</td>
        <td>
          ${escapeHTML(order.customerName)}
          <br>
          ${escapeHTML(order.phone)}
        </td>
        <td>$${Number(order.total).toFixed(2)}</td>
        <td>
          <select onchange="changeStatus(${order.id}, this.value)">
            ${["New", "Processing", "Completed", "Cancelled"]
              .map(status => `
                <option
                  ${status === order.status ? "selected" : ""}
                >
                  ${status}
                </option>
              `).join("")}
          </select>
        </td>
        <td>${escapeHTML(order.createdAt)}</td>
      </tr>
    `).join("");
  } catch (error) {
    alert(error.message);
  }
}

async function changeStatus(id, status) {
  try {
    await api("/api/admin/orders/" + id, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    await dashboard();
  } catch (error) {
    alert(error.message);
  }
}

boot();
