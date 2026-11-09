const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Habilitar CORS de amplio espectro absoluto para Vercel
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

const dbDir = path.resolve(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.resolve(dbDir, 'moravana.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error base de datos:', err.message);
    } else {
        db.serialize(() => {
            db.run('CREATE TABLE IF NOT EXISTS locaciones (id INTEGER PRIMARY KEY, nombre TEXT, tipo TEXT, direccion TEXT)');
            db.run('CREATE TABLE IF NOT EXISTS materiales (id INTEGER PRIMARY KEY, nombre TEXT, unidad_medida TEXT, stock_minimo_alerta INTEGER)');
            db.run('CREATE TABLE IF NOT EXISTS herramientas (id INTEGER PRIMARY KEY, nombre TEXT, codigo_qr TEXT UNIQUE, estado TEXT DEFAULT "Disponible")');
            db.run('CREATE TABLE IF NOT EXISTS materiales_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER, locacion_id INTEGER, cantidad_actual REAL, UNIQUE(material_id, locacion_id))');
            db.run('CREATE TABLE IF NOT EXISTS pedidos_herramientas (id INTEGER PRIMARY KEY AUTOINCREMENT, herramienta_id INTEGER, locacion_origen_id INTEGER, locacion_destino_id INTEGER, duracion_dias INTEGER, estado_pedido TEXT DEFAULT "Pendiente")');
            
            db.run("INSERT OR IGNORE INTO locaciones (id, nombre, tipo, direccion) VALUES " +
                   "(1, 'Almacen Central Cabudare', 'Almacen Central', 'Sede Principal Base'), " +
                   "(2, 'Deposito Externo Planta Chivacoa', 'Deposito Temporal', 'Grupo Polar'), " +
                   "(3, 'Obra y Deposito El ITALO', 'Deposito Temporal', 'Obra Activa'), " +
                   "(4, 'Obra Carrera Once 11', 'Obra Corta', 'Deposito en sitio'), " +
                   "(5, 'Unidad Movil Cajon Turen', 'Obra Corta', 'Frente Movil'), " +
                   "(6, 'Obra La Cuarenta y Dos 42', 'Obra Corta', 'Frente asignado')");
        });
    }
});

app.options('*', cors());

app.get('/api/herramientas', (req, res) => {
    const sql = `
        SELECT h.id, h.nombre, h.codigo_qr, h.estado, l.nombre AS ubicacion_actual
        FROM herramientas h
        LEFT JOIN pedidos_herramientas ph ON h.id = ph.herramienta_id AND ph.estado_pedido IN ('Pendiente', 'En traslado', 'Entregado')
        LEFT JOIN locaciones l ON ph.locacion_destino_id = l.id
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const result = rows.map(row => ({ ...row, ubicacion_actual: row.ubicacion_actual || 'Almacen Central Cabudare' }));
        res.json(result);
    });
});

app.get('/api/materiales/lista', (req, res) => {
    db.all('SELECT id, nombre, unidad_medida FROM materiales ORDER BY nombre ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/materiales/stock/:locacion_id', (req, res) => {
    const sql = `
        SELECT m.id, m.nombre, m.unidad_medida, ms.cantidad_actual, m.stock_minimo_alerta, 
               CASE WHEN ms.cantidad_actual <= m.stock_minimo_alerta THEN 1 ELSE 0 END AS alerta_stock 
        FROM materiales_stock ms 
        JOIN materiales m ON ms.material_id = m.id 
        WHERE ms.locacion_id = ? ORDER BY m.nombre ASC
    `;
    db.all(sql, [req.params.locacion_id], (err, rows) => { 
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows); 
    });
});

app.post('/api/materiales/importar-bloque', (req, res) => {
    const { locacion_id, texto_bruto } = req.body;
    if (!texto_bruto) return res.status(400).json({ error: 'Texto vacio' });
    const lineas = texto_bruto.split('\n');
    let ingresados = 0;
    db.serialize(() => {
        lineas.forEach(linea => {
            if(!linea.trim()) return;
            const partes = linea.trim().match(/(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
            if (partes) {
                const nombre = partes[1].trim();
                const cantidad = parseFloat(partes[2]);
                if (nombre.length > 2 && cantidad >= 0) {
                    ingresados++;
                    db.run("INSERT OR IGNORE INTO materiales (nombre, unidad_medida, stock_minimo_alerta) VALUES (?, 'Unidades', 10)", [nombre], function() {
                        db.get("SELECT id FROM materiales WHERE nombre = ?", [nombre], (err, row) => {
                            if (row) {
                                // CORREGIDO: cantidad_actual en lugar de quantity_actual
                                db.run("INSERT OR REPLACE INTO materiales_stock (material_id, locacion_id, cantidad_actual) VALUES (?, ?, ?)", [row.id, locacion_id, cantidad]);
                            }
                        });
                    });
                }
            }
        });
        setTimeout(() => res.json({ message: 'Carga masiva completada con exito. Items indexados: ' + ingresados }), 600);
    });
});

app.listen(PORT, () => console.log('Servidor operativo de Moravana en puerto ' + PORT));
