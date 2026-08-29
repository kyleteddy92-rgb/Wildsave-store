const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = 3000;

const dataDir = path.join(__dirname, "data");
const dbFile = path.join(dataDir, "db.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function loadDB() {
  if (!fs.existsSync(dbFile)) {
    const db = {
      admin: {
        username: "admin",
        passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12)
      },
      products: [
        {
          id: 1,
          name: "LED Bulb 12W",
          price: 3.5,
          stock: 25,
          category: "Lighting"
        },
        {
          id: 2,
          name: "Electrical Extension 5m",
          price: 12,
          stock: 15,
          category: "Accessories"
        },
        {
          id: 3,
          name: "Double Wall Socket",
          price: 5.5,
          stock: 30,
          category: "Switches & Sockets"
        }
      ],
      orders: []
    };

    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    return db;
  }

  return JSON.parse(fs.readFileSync(dbFile, "utf8"));
}

function saveDB() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

let db = loadDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "public", "uploads"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  }
});

app.post("/api/admin/upload", adminOnly, upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "No image selected."
    });
  }

  res.json({
    image: "/uploads/" + req.file.filename
  });
});


function adminOnly(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin login required"
    });
  }

  next();
}

app.get("/api/products", (req, res) => {
  res.json(db.products);
});

app.post("/api/orders", (req, res) => {
  const { customerName, phone, items } = req.body;

  if (!customerName || !phone || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: "Customer name, phone and items are required."
    });
  }

  const orderItems = [];
  let total = 0;

  for (const item of items) {
    const product = db.products.find(
      p => p.id === Number(item.id)
    );

    const quantity = Math.max(
      1,
      Number(item.qty) || 1
    );

    if (!product) {
      return res.status(400).json({
        error: "Product not found."
      });
    }

    if (quantity > product.stock) {
      return res.status(400).json({
        error: `Not enough stock for ${product.name}.`
      });
    }

    orderItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: quantity
    });

    total += product.price * quantity;
  }

  for (const item of orderItems) {
    const product = db.products.find(
      p => p.id === item.id
    );

    product.stock -= item.qty;
  }

  const order = {
    id: Date.now(),
    customerName: String(customerName).trim(),
    phone: String(phone).trim(),
    items: orderItems,
    total: Number(total.toFixed(2)),
    status: "New",
    createdAt: new Date().toISOString()
  };

  db.orders.unshift(order);
  saveDB();

  res.status(201).json(order);
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === db.admin.username &&
    bcrypt.compareSync(
      password || "",
      db.admin.passwordHash
    )
  ) {
    req.session.admin = true;

    return res.json({
      ok: true
    });
  }

  res.status(401).json({
    error: "Invalid username or password"
  });
});

app.post("/api/admin/logout", adminOnly, (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});

app.get("/api/admin/me", adminOnly, (req, res) => {
  res.json({
    username: db.admin.username
  });
});

app.get("/api/admin/dashboard", adminOnly, (req, res) => {
  const revenue = db.orders.reduce(
    (sum, order) => sum + order.total,
    0
  );

  res.json({
    products: db.products.length,
    orders: db.orders.length,
    revenue: Number(revenue.toFixed(2)),
    lowStock: db.products.filter(
      p => p.stock <= 5
    ).length
  });
});

app.get("/api/admin/products", adminOnly, (req, res) => {
  res.json(db.products);
});

app.post("/api/admin/products", adminOnly, (req, res) => {
  const { name, price, stock, category } = req.body;

  if (
    !name ||
    Number.isNaN(Number(price)) ||
    Number.isNaN(Number(stock))
  ) {
    return res.status(400).json({
      error: "Name, price and stock are required."
    });
  }

  const product = {
    id: Date.now(),
    name: String(name).trim(),
    price: Number(price),
    stock: Math.max(0, Number(stock)),
    category: String(
      category || "General"
    ).trim()
  };

  db.products.push(product);
  saveDB();

  res.status(201).json(product);
});

app.delete(
  "/api/admin/products/:id",
  adminOnly,
  (req, res) => {
    db.products = db.products.filter(
      product =>
        product.id !== Number(req.params.id)
    );

    saveDB();

    res.json({
      ok: true
    });
  }
);

app.get("/api/admin/orders", adminOnly, (req, res) => {
  res.json(db.orders);
});

app.patch(
  "/api/admin/orders/:id",
  adminOnly,
  (req, res) => {
    const order = db.orders.find(
      order =>
        order.id === Number(req.params.id)
    );

    if (!order) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    const allowedStatuses = [
      "New",
      "Processing",
      "Completed",
      "Cancelled"
    ];

    if (
      !allowedStatuses.includes(
        req.body.status
      )
    ) {
      return res.status(400).json({
        error: "Invalid order status."
      });
    }

    order.status = req.body.status;
    saveDB();

    res.json(order);
  }
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Wildsave running at http://127.0.0.1:${PORT}`
  );
});
