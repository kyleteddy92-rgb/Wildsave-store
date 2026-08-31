const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

app.get("/api/health",(req,res)=>{
  res.json({ok:true,name:"Wildsave Electrical Store"});
});

const bcrypt=require("bcryptjs");

app.use(require("express-session")({
  secret:process.env.SESSION_SECRET,
  resave:false,
  saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:false}
}));

const adminPasswordHash=bcrypt.hashSync(process.env.ADMIN_PASSWORD,12);

app.post("/api/admin/login",async(req,res)=>{
  const {username,password}=req.body;

  if(username===process.env.ADMIN_USERNAME &&
     await bcrypt.compare(password||"",adminPasswordHash)){
    req.session.admin=true;
    return res.json({success:true});
  }

  res.status(401).json({success:false,error:"Invalid login details"});
});

app.get("/api/admin/status",(req,res)=>{
  res.json({loggedIn:req.session.admin===true});
});

app.post("/api/admin/logout",(req,res)=>{
  req.session.destroy(()=>res.json({success:true}));
});

const multer=require("multer");
const cloudinary=require("cloudinary").v2;

cloudinary.config({
  cloud_name:process.env.CLOUDINARY_CLOUD_NAME,
  api_key:process.env.CLOUDINARY_API_KEY,
  api_secret:process.env.CLOUDINARY_API_SECRET
});

const upload=multer({
  dest:"uploads/",
  limits:{fileSize:10*1024*1024}
});

function requireAdmin(req,res,next){
  if(!req.session.admin)
    return res.status(401).json({error:"Admin login required"});
  next();
}

app.post("/api/admin/upload",requireAdmin,upload.single("image"),async(req,res)=>{
  try{
    if(!req.file)
      return res.status(400).json({error:"No image selected"});

    console.log("Uploading image:",req.file.originalname);

    const result=await cloudinary.uploader.upload(req.file.path,{
      folder:"wildsave/products",
      resource_type:"image"
    });

    require("fs").unlinkSync(req.file.path);

    console.log("Upload complete:",result.secure_url);

    res.json({
      success:true,
      imageUrl:result.secure_url,
      publicId:result.public_id
    });
  }catch(error){
    console.error("UPLOAD ERROR:",error);

    if(req.file && require("fs").existsSync(req.file.path))
      require("fs").unlinkSync(req.file.path);

    res.status(500).json({
      success:false,
      error:error.message||"Image upload failed"
    });
  }
});

const dataDir=require("path").join(__dirname,"data");
const productsFile=require("path").join(dataDir,"products.json");
const ordersFile=require("path").join(dataDir,"orders.json");

if(!require("fs").existsSync(dataDir))
  require("fs").mkdirSync(dataDir,{recursive:true});

if(!require("fs").existsSync(productsFile))
  require("fs").writeFileSync(productsFile,"[]");

if(!require("fs").existsSync(ordersFile))
  require("fs").writeFileSync(ordersFile,"[]");

function readProducts(){
  try{return JSON.parse(require("fs").readFileSync(productsFile,"utf8"))}
  catch{return []}
}

function saveProducts(products){
  require("fs").writeFileSync(productsFile,JSON.stringify(products,null,2));
}

function readOrders(){
  try{
    return JSON.parse(
      require("fs").readFileSync(ordersFile,"utf8")
    );
  }catch{
    return [];
  }
}

function saveOrders(orders){
  require("fs").writeFileSync(
    ordersFile,
    JSON.stringify(orders,null,2)
  );
}

app.get("/api/products",(req,res)=>{
  res.json(readProducts());
});

app.post("/api/orders",(req,res)=>{
  try{
    const {
      name,
      phone,
      country,
      city,
      address,
      notes,
      items
    }=req.body;

    if(!name || !phone || !country || !city || !address){
      return res.status(400).json({
        success:false,
        error:"Name, phone, country, city and address are required"
      });
    }

    if(!["Zimbabwe","South Africa"].includes(country)){
      return res.status(400).json({
        success:false,
        error:"Delivery is currently available only in Zimbabwe and South Africa"
      });
    }

    if(!Array.isArray(items) || !items.length){
      return res.status(400).json({
        success:false,
        error:"Your cart is empty"
      });
    }

    const products=readProducts();
    const updatedProducts=JSON.parse(JSON.stringify(products));
    const orderItems=[];
    let total=0;

    for(const item of items){

      const product=updatedProducts.find(
        p=>String(p.id)===String(item.productId)
      );

      if(!product){
        return res.status(400).json({
          success:false,
          error:"A product in your cart is no longer available"
        });
      }

      const quantity=Number(item.quantity);

      if(!Number.isInteger(quantity) || quantity<1){
        return res.status(400).json({
          success:false,
          error:"Invalid quantity"
        });
      }

      const color=String(item.color||"").trim();

      if(!color){
        return res.status(400).json({
          success:false,
          error:"Please select a colour for every product"
        });
      }

      const colorStock=product.colorStock || {};

      const hasColorStock=
        Object.prototype.hasOwnProperty.call(colorStock,color);

      const available=hasColorStock
        ? Number(colorStock[color])||0
        : Number(product.stock)||0;

      if(quantity>available){
        return res.status(400).json({
          success:false,
          error:`Only ${available} left in ${color} for ${product.name}`
        });
      }

      if(hasColorStock){

        colorStock[color]=available-quantity;

        product.colorStock=colorStock;
        product.colors=Object.keys(colorStock);

        product.stock=Object.values(colorStock)
          .reduce(
            (sum,value)=>sum+(Number(value)||0),
            0
          );

      }else{

        product.stock=available-quantity;

      }

      const price=Number(product.price)||0;
      const lineTotal=price*quantity;

      orderItems.push({
        productId:product.id,
        name:product.name,
        image:product.image||"",
        color,
        quantity,
        price,
        lineTotal
      });

      total+=lineTotal;
    }

    const orders=readOrders();

    const order={
      id:Date.now().toString(),
      customer:{
        name:String(name).trim(),
        phone:String(phone).trim(),
        country,
        city:String(city).trim(),
        address:String(address).trim(),
        notes:String(notes||"").trim()
      },
      items:orderItems,
      total,
      status:"Pending",
      createdAt:new Date().toISOString()
    };

    orders.push(order);

    saveProducts(updatedProducts);
    saveOrders(orders);

    res.json({
      success:true,
      orderId:order.id
    });

  }catch(error){

    console.error("ORDER ERROR:",error);

    res.status(500).json({
      success:false,
      error:"Could not place order"
    });
  }
});

app.get("/api/admin/orders",requireAdmin,(req,res)=>{
  res.json(readOrders());
});

app.put("/api/admin/orders/:id",requireAdmin,(req,res)=>{

  const orders=readOrders();

  const order=orders.find(
    o=>String(o.id)===String(req.params.id)
  );

  if(!order){
    return res.status(404).json({
      success:false,
      error:"Order not found"
    });
  }

  const allowed=[
    "Pending",
    "Processing",
    "Completed",
    "Cancelled"
  ];

  if(!allowed.includes(req.body.status)){
    return res.status(400).json({
      success:false,
      error:"Invalid order status"
    });
  }

  order.status=req.body.status;

  saveOrders(orders);

  res.json({
    success:true,
    order
  });
});

app.delete("/api/admin/orders/:id",requireAdmin,(req,res)=>{

  const orders=readOrders();

  const filtered=orders.filter(
    o=>String(o.id)!==String(req.params.id)
  );

  if(filtered.length===orders.length){
    return res.status(404).json({
      success:false,
      error:"Order not found"
    });
  }

  saveOrders(filtered);

  res.json({success:true});
});

app.post("/api/admin/products",requireAdmin,(req,res)=>{
  const products=readProducts();
  const {name,description,price,category,stock,colors,colorStock,image}=req.body;

  if(!name||!price)
    return res.status(400).json({error:"Name and price are required"});

  const product={
    id:Date.now().toString(),
    name,
    description:description||"",
    price,
    category:category||"Other",
    stock:Number(stock)||0,
    colors:Array.isArray(colors)?colors:[],
    colorStock:colorStock && typeof colorStock==="object" ? colorStock : {},
    image:image||"",
    createdAt:new Date().toISOString()
  };

  products.push(product);
  saveProducts(products);

  res.json({success:true,product});
});


app.put("/api/admin/products/:id",requireAdmin,(req,res)=>{
  const products=readProducts();
  const index=products.findIndex(p=>p.id===req.params.id);

  if(index===-1)
    return res.status(404).json({error:"Product not found"});

  const old=products[index];
  const {name,description,price,category,stock,colors,colorStock,image}=req.body;

  if(!name || !price)
    return res.status(400).json({error:"Name and price are required"});

  products[index]={
    ...old,
    name,
    description:description||"",
    price,
    category:category||"Other",
    stock:Number(stock)||0,
    colors:Array.isArray(colors)?colors:[],
    colorStock:colorStock && typeof colorStock==="object" ? colorStock : {},
    image:image || old.image || ""
  };

  saveProducts(products);

  res.json({success:true,product:products[index]});
});

app.delete("/api/admin/products/:id",requireAdmin,(req,res)=>{
  const products=readProducts();
  const index=products.findIndex(p=>p.id===req.params.id);

  if(index===-1)
    return res.status(404).json({error:"Product not found"});

  const deleted=products.splice(index,1)[0];
  saveProducts(products);

  res.json({success:true,product:deleted});
});

app.use(require("express").static(require("path").join(__dirname,"public")));

app.get("/",(req,res)=>{
  res.sendFile(require("path").join(__dirname,"public","index.html"));
});

app.listen(PORT, () => {
  console.log("Wildsave server running on port " + PORT);
});
