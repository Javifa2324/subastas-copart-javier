require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { createServer } = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const http = createServer(app);
const io = new Server(http);
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 24) throw new Error('Configura JWT_SECRET con al menos 24 caracteres.');
const db = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: { encrypt: process.env.DB_ENCRYPT !== 'false', trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};
let pool;
const getPool = async () => pool || (pool = await new sql.ConnectionPool(db).connect());
const failure = (res, error) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Error del servidor. Revisa la configuración de la base de datos.' });
};
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const trimmed = (v, max = 180) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const auth = (req, res, next) => {
  try {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (!token) throw Error();
    req.user = jwt.verify(token, secret);
    next();
  } catch { res.status(401).json({ error: 'Inicia sesión para continuar.' }); }
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nombre, apellido, correo, telefono, clave } = req.body;
    if (![nombre, apellido, correo, telefono].every(x => trimmed(x).length >= 2) || !/^\S+@\S+\.\S+$/.test(correo) || typeof clave !== 'string' || clave.length < 8) throw bad('Completa nombre, apellido, correo, teléfono y contraseña de al menos 8 caracteres.');
    const p = await getPool();
    const hash = await bcrypt.hash(clave, 11);
    const r = await p.request().input('n', sql.NVarChar(100), trimmed(nombre, 100)).input('a', sql.NVarChar(100), trimmed(apellido, 100)).input('e', sql.NVarChar(180), trimmed(correo.toLowerCase())).input('t', sql.NVarChar(30), trimmed(telefono, 30)).input('h', sql.NVarChar(255), hash)
      .query('INSERT INTO dbo.Copart_Javier_Usuarios(Nombre,Apellido,Correo,Telefono,ClaveHash) OUTPUT INSERTED.Id VALUES(@n,@a,@e,@t,@h)');
    const id = r.recordset[0].Id;
    res.status(201).json({ token: jwt.sign({ id, nombre: trimmed(nombre, 100) }, secret, { expiresIn: '12h' }), usuario: { id, nombre: trimmed(nombre, 100) } });
  } catch (e) { if (e.number === 2627 || e.number === 2601) e = bad('Este correo ya está registrado.', 409); failure(res, e); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().input('e', sql.NVarChar(180), trimmed(req.body.correo).toLowerCase()).query('SELECT TOP 1 Id,Nombre,ClaveHash FROM dbo.Copart_Javier_Usuarios WHERE Correo=@e');
    const user = r.recordset[0];
    if (!user || !await bcrypt.compare(req.body.clave || '', user.ClaveHash)) throw bad('Correo o contraseña incorrectos.', 401);
    res.json({ token: jwt.sign({ id: user.Id, nombre: user.Nombre }, secret, { expiresIn: '12h' }), usuario: { id: user.Id, nombre: user.Nombre } });
  } catch (e) { failure(res, e); }
});

const vehicleSelect = `SELECT v.Id,v.VendedorId,v.Anio,v.Tipo,v.Marca,v.Modelo,v.Motor,v.Transmision,v.Combustible,v.Traccion,v.Cilindros,v.Danio,v.PrecioBase,v.Inicio,v.Fin,
  (SELECT MAX(p.Monto) FROM dbo.Copart_Javier_Pujas p WHERE p.VehiculoId=v.Id) AS OfertaActual,
  (SELECT TOP 1 p.UsuarioId FROM dbo.Copart_Javier_Pujas p WHERE p.VehiculoId=v.Id ORDER BY p.Monto DESC,p.Id DESC) AS GanadorId
  FROM dbo.Copart_Javier_Vehiculos v`;
function publicVehicle(v, userId) {
  const now = Date.now(), start = new Date(v.Inicio).getTime(), end = new Date(v.Fin).getTime();
  const estado = now < start ? 'próxima' : now >= end ? (Number(v.OfertaActual) >= Number(v.PrecioBase) ? 'vendida' : 'desierta') : 'activa';
  const { GanadorId, ...safe } = v;
  return { ...safe, estado, soyGanador: !!userId && userId === GanadorId, ofertaMinima: v.OfertaActual ? Math.floor((Math.round(Number(v.OfertaActual) * 100) * 11 + 9) / 10) / 100 : Number(v.PrecioBase) };
}
function optionalUser(req) { try { return jwt.verify(/^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1], secret).id; } catch { return null; } }

app.get('/api/vehiculos', async (req, res) => {
  try {
    const p = await getPool();
    const rows = (await p.request().query(`${vehicleSelect} ORDER BY v.Id DESC`)).recordset;
    const filters = ['Marca', 'Modelo', 'Tipo', 'Combustible', 'Danio', 'Anio'];
    const list = rows.filter(v => filters.every(k => !req.query[k.toLowerCase()] || String(v[k]).toLowerCase().includes(String(req.query[k.toLowerCase()]).toLowerCase()))).map(v => publicVehicle(v, optionalUser(req)));
    res.json(list);
  } catch (e) { failure(res, e); }
});
app.get('/api/vehiculos/:id', async (req, res) => {
  try {
    const p = await getPool(), id = Number(req.params.id);
    if (!Number.isInteger(id)) throw bad('ID inválido.');
    const v = (await p.request().input('id', sql.Int, id).query(`${vehicleSelect} WHERE v.Id=@id`)).recordset[0];
    if (!v) throw bad('Vehículo no encontrado.', 404);
    const fotos = (await p.request().input('id', sql.Int, id).query('SELECT Url FROM dbo.Copart_Javier_Fotos WHERE VehiculoId=@id ORDER BY Orden')).recordset.map(f => f.Url);
    res.json({ ...publicVehicle(v, optionalUser(req)), fotos });
  } catch (e) { failure(res, e); }
});

function validateVehicle(b) {
  const fields = ['tipo','marca','modelo','motor','transmision','combustible','traccion','danio'];
  if (fields.some(k => !trimmed(b[k], 80))) throw bad('Completa toda la ficha técnica.');
  if (!['Verde','Amarillo','Rojo'].includes(b.danio) || !['AWD','FWD','RWD','4WD'].includes(b.traccion)) throw bad('Daño o tracción inválidos.');
  if (!Number.isInteger(Number(b.anio)) || Number(b.anio) < 1900 || Number(b.anio) > new Date().getFullYear() + 1 || !Number.isInteger(Number(b.cilindros)) || Number(b.cilindros) < 1 || Number(b.cilindros) > 24) throw bad('Año o cilindros inválidos.');
  if (!Number.isFinite(Number(b.precioBase)) || Number(b.precioBase) <= 0) throw bad('Precio base inválido.');
  if (!Number.isFinite(Date.parse(b.inicio)) || !Number.isFinite(Date.parse(b.fin)) || Date.parse(b.fin) <= Date.parse(b.inicio) || Date.parse(b.fin) <= Date.now()) throw bad('Las fechas de inicio y fin no son válidas.');
  if (!Array.isArray(b.fotos) || b.fotos.length < 5 || b.fotos.length > 15 || b.fotos.some(u => typeof u !== 'string' || u.length > 1000 || !/^https:\/\//i.test(u))) throw bad('Agrega al menos 5 URL de fotografías HTTPS.');
}
function fillVehicle(req, b) {
  const defs = [['anio',sql.Int,Number(b.anio)],['tipo',sql.NVarChar(70),trimmed(b.tipo,70)],['marca',sql.NVarChar(80),trimmed(b.marca,80)],['modelo',sql.NVarChar(80),trimmed(b.modelo,80)],['motor',sql.NVarChar(80),trimmed(b.motor,80)],['transmision',sql.NVarChar(80),trimmed(b.transmision,80)],['combustible',sql.NVarChar(60),trimmed(b.combustible,60)],['traccion',sql.NVarChar(20),b.traccion],['cilindros',sql.Int,Number(b.cilindros)],['danio',sql.NVarChar(20),b.danio],['precio',sql.Decimal(18,2),Number(b.precioBase)],['inicio',sql.DateTime2,new Date(b.inicio)],['fin',sql.DateTime2,new Date(b.fin)]];
  for (const [k,t,v] of defs) req.input(k,t,v);
  return req;
}
const columns = 'Anio,Tipo,Marca,Modelo,Motor,Transmision,Combustible,Traccion,Cilindros,Danio,PrecioBase,Inicio,Fin';
const params = '@anio,@tipo,@marca,@modelo,@motor,@transmision,@combustible,@traccion,@cilindros,@danio,@precio,@inicio,@fin';
async function photos(t,id,fotos) {
  await new sql.Request(t).input('id',sql.Int,id).query('DELETE FROM dbo.Copart_Javier_Fotos WHERE VehiculoId=@id');
  for (let i=0;i<fotos.length;i++) await new sql.Request(t).input('id',sql.Int,id).input('url',sql.NVarChar(1000),fotos[i]).input('orden',sql.Int,i).query('INSERT INTO dbo.Copart_Javier_Fotos(VehiculoId,Url,Orden) VALUES(@id,@url,@orden)');
}
app.post('/api/vehiculos', auth, async (req,res) => {
  let t;
  try {
    validateVehicle(req.body);
    t = new sql.Transaction(await getPool()); await t.begin();
    const r = await fillVehicle(new sql.Request(t),req.body).input('user',sql.Int,req.user.id).query(`INSERT dbo.Copart_Javier_Vehiculos(VendedorId,${columns}) OUTPUT INSERTED.Id VALUES(@user,${params})`);
    const id = r.recordset[0].Id;
    await photos(t,id,req.body.fotos); await t.commit(); t=null;
    io.emit('catalogo:actualizado'); res.status(201).json({ id });
  } catch (e) { if (t) await t.rollback().catch(()=>{}); failure(res,e); }
});
app.put('/api/vehiculos/:id', auth, async (req,res) => {
  let t;
  try {
    validateVehicle(req.body);
    const id = Number(req.params.id);
    t = new sql.Transaction(await getPool()); await t.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const exists = (await new sql.Request(t).input('id',sql.Int,id).query('SELECT VendedorId FROM dbo.Copart_Javier_Vehiculos WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id')).recordset[0];
    if (!exists) throw bad('Vehículo no encontrado.',404);
    if (exists.VendedorId !== req.user.id) throw bad('Solo el propietario puede editarlo.',403);
    const count = (await new sql.Request(t).input('id',sql.Int,id).query('SELECT COUNT(*) AS N FROM dbo.Copart_Javier_Pujas WHERE VehiculoId=@id')).recordset[0].N;
    if (count) throw bad('No puedes editar un vehículo que ya recibió pujas.',409);
    await fillVehicle(new sql.Request(t),req.body).input('id',sql.Int,id).query(`UPDATE dbo.Copart_Javier_Vehiculos SET ${columns.split(',').map((c,i)=>c+'='+params.split(',')[i]).join(',')} WHERE Id=@id`);
    await photos(t,id,req.body.fotos); await t.commit(); t=null;
    io.emit('catalogo:actualizado'); res.json({ id });
  } catch (e) { if (t) await t.rollback().catch(()=>{}); failure(res,e); }
});

app.post('/api/vehiculos/:id/pujas', auth, async (req,res) => {
  let t;
  try {
    const id = Number(req.params.id), monto = Number(req.body.monto);
    if (!Number.isInteger(id) || !Number.isFinite(monto) || monto <= 0 || Math.abs(Math.round(monto*100) - monto*100) > 0.000001) throw bad('Monto inválido.');
    t = new sql.Transaction(await getPool()); await t.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const v = (await new sql.Request(t).input('id',sql.Int,id).query('SELECT VendedorId,PrecioBase,Inicio,Fin FROM dbo.Copart_Javier_Vehiculos WITH (UPDLOCK,HOLDLOCK) WHERE Id=@id')).recordset[0];
    if (!v) throw bad('Vehículo no encontrado.',404);
    if (v.VendedorId === req.user.id) throw bad('No puedes ofertar por tu propio vehículo.',403);
    const now = Date.now();
    if (now < new Date(v.Inicio).getTime() || now >= new Date(v.Fin).getTime()) throw bad('La subasta no está abierta.',409);
    const top = (await new sql.Request(t).input('id',sql.Int,id).query('SELECT MAX(Monto) AS Monto FROM dbo.Copart_Javier_Pujas WHERE VehiculoId=@id')).recordset[0].Monto;
    const min = top === null ? Number(v.PrecioBase) : Math.floor((Math.round(Number(top)*100)*11+9)/10)/100;
    if (monto < min) throw bad(`La oferta mínima es Q ${min.toFixed(2)}.`,409);
    await new sql.Request(t).input('id',sql.Int,id).input('user',sql.Int,req.user.id).input('monto',sql.Decimal(18,2),monto).query('INSERT INTO dbo.Copart_Javier_Pujas(VehiculoId,UsuarioId,Monto) VALUES(@id,@user,@monto)');
    await t.commit(); t=null;
    io.to(`vehiculo:${id}`).emit('puja:actualizada',{ id, monto, ganadorId:req.user.id });
    io.emit('catalogo:actualizado'); res.status(201).json({ monto });
  } catch (e) { if (t) await t.rollback().catch(()=>{}); failure(res,e); }
});

io.on('connection',socket => {
  socket.on('vehiculo:seguir',id => { if (Number.isInteger(Number(id)) && Number(id)>0) socket.join(`vehiculo:${Number(id)}`); });
});
app.get('/api/salud',(_,res)=>res.json({ok:true}));
app.get('*',(_,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

async function start() {
  const p = await getPool();
  // El esquema se instala solo si el usuario tiene CREATE TABLE. Fallará claramente si no tiene permiso.
  const script = fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await p.request().batch(script);
  if (process.env.SEED_DEMO === 'true') await seedDemo(p);
  http.listen(process.env.PORT || 3000,()=>console.log(`Subastas Copart en puerto ${process.env.PORT || 3000}`));
}
async function seedDemo(p) {
  for (let i=1;i<=3;i++) {
    const correo=`demo${i}@copart.test`;
    const found=(await p.request().input('c',sql.NVarChar(180),correo).query('SELECT Id FROM dbo.Copart_Javier_Usuarios WHERE Correo=@c')).recordset[0];
    if (!found) await p.request().input('n',sql.NVarChar(100),`Demo ${i}`).input('a',sql.NVarChar(100),'Subastas').input('c',sql.NVarChar(180),correo).input('t',sql.NVarChar(30),'55550000').input('h',sql.NVarChar(255),await bcrypt.hash(`DemoCopart2026!${i}`,11)).query('INSERT dbo.Copart_Javier_Usuarios(Nombre,Apellido,Correo,Telefono,ClaveHash) VALUES(@n,@a,@c,@t,@h)');
  }
  const demo=(await p.request().query("SELECT Id FROM dbo.Copart_Javier_Usuarios WHERE Correo='demo1@copart.test'")).recordset[0];
  const count=(await p.request().input('id',sql.Int,demo.Id).query('SELECT COUNT(*) AS N FROM dbo.Copart_Javier_Vehiculos WHERE VendedorId=@id')).recordset[0].N;
  if (count) return;
  const now=Date.now();
  const samples=[['Toyota','Corolla',2020,'Sedán','Verde',25000,0],['Honda','CR-V',2019,'SUV','Amarillo',38000,1],['Ford','Mustang',2018,'Coupé','Rojo',55000,2]];
  const ids=['photo-1549317661-bd32c8ce0db2','photo-1552519507-da3b142c6e3d','photo-1503376780353-7e6692767b70','photo-1507136566006-cfc505b114fc','photo-1494976388531-d1058494cdd8'];
  for (const [marca,modelo,anio,tipo,danio,precio,n] of samples) {
    const b={anio,tipo,marca,modelo,motor:'2.0 L',transmision:'Automática',combustible:'Gasolina',traccion:'FWD',cilindros:4,danio,precioBase:precio,inicio:new Date(now-3600000).toISOString(),fin:new Date(now+(n+2)*86400000).toISOString()};
    const r=await fillVehicle(p.request(),b).input('user',sql.Int,demo.Id).query(`INSERT dbo.Copart_Javier_Vehiculos(VendedorId,${columns}) OUTPUT INSERTED.Id VALUES(@user,${params})`);
    for(let j=0;j<5;j++) await p.request().input('id',sql.Int,r.recordset[0].Id).input('url',sql.NVarChar(1000),`https://images.unsplash.com/${ids[(j+n)%ids.length]}?w=1200&q=80`).input('orden',sql.Int,j).query('INSERT dbo.Copart_Javier_Fotos(VehiculoId,Url,Orden) VALUES(@id,@url,@orden)');
  }
}
start().catch(e=>{ console.error('No se pudo iniciar la base de datos:',e); process.exit(1); });
