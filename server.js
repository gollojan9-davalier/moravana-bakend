const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../frontend')));

const dbPath = path.resolve(__dirname, '../database/moravana.db');
const db = new sqlite3.Database(dbPath);

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

app.post('/api/materiales/consumir', (req, res) => {
    const { material_id, locacion_id, cantidad_a_descontar } = req.body;
    db.get('SELECT cantidad_actual FROM materiales_stock WHERE material_id = ? AND locacion_id = ?', [material_id, locacion_id], (err, row) => {
        if (!row || row.cantidad_actual < cantidad_a_descontar) return res.status(400).json({ error: 'Material insuficiente' });
        const nuevaCantidad = row.cantidad_actual - cantidad_a_descontar;
        db.run('UPDATE materiales_stock SET cantidad_actual = ? WHERE material_id = ? AND locacion_id = ?', [nuevaCantidad, material_id, locacion_id], () => {
            res.json({ message: 'Consumo registrado con exito.' });
        });
    });
});

// API INTELIGENTE FLEX-FORMAT: Soporta [Cantidad] [Descripcion] y [Descripcion] [Cantidad]
app.post('/api/materiales/importar-bloque', (req, res) => {
    const { locacion_id, texto_bruto } = req.body;
    if (!texto_bruto) return res.status(400).json({ error: 'Texto vacio' });

    const lineas = texto_bruto.split('\n');
    let ingresados = 0;

    db.serialize(() => {
        lineas.forEach(linea => {
            const l = linea.trim();
            if (!l || l.startsWith('CANTIDAD')) return; // Omitir encabezados de la planilla

            let nombre = "";
            let cantidad = 0;

            // PATRON A: El numero viene al PRINCIPIO (Ej: 2 Cepillos de barrer)
            const matchPrincipio = l.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
            // PATRON B: El numero viene al FINAL (Ej: Cepillos de barrer 2)
            const matchFinal = l.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);

            if (matchPrincipio) {
                cantidad = parseFloat(matchPrincipio[1]);
                nombre = matchPrincipio[2].trim();
            } else if (matchFinal) {
                nombre = matchFinal[1].trim();
                cantidad = parseFloat(matchFinal[2]);
            }

            // Si se logro extraer informacion valida, se guarda en SQLite
            if (nombre && nombre.length > 2 && !isNaN(cantidad)) {
                ingresados++;
                db.run("INSERT OR IGNORE INTO materiales (nombre, unidad_medida, stock_minimo_alerta) VALUES (?, 'Unidades', 10)", [nombre], function() {
                    db.get("SELECT id FROM materiales WHERE nombre = ?", [nombre], (err, row) => {
                        if (row) {
                            db.run("INSERT OR REPLACE INTO materiales_stock (material_id, locacion_id, cantidad_actual) VALUES (?, ?, ?)", [row.id, locacion_id, cantidad]);
                        }
                    });
                });
            }
        });

        setTimeout(() => {
            res.json({ message: 'Carga masiva completada con exito. Se procesaron e indexaron ' + ingresados + ' items reales en la obra.' });
        }, 800);
    });
});

app.post('/api/pedidos/crear', (req, res) => {
    const { herramienta_id, locacion_destino_id, duracion_dias } = req.body;
    db.serialize(() => {
        db.run('INSERT INTO pedidos_herramientas (herramienta_id, locacion_origen_id, locacion_destino_id, duracion_dias, estado_pedido) VALUES (?, 1, ?, ?, "Pendiente")', [herramienta_id, locacion_destino_id, duracion_dias]);
        db.run('UPDATE herramientas SET estado = "Reservada" WHERE id = ?', [herramienta_id], () => res.json({ message: 'Pedido procesado.' }));
    });
});

app.post('/api/pedidos/devolver', (req, res) => {
    const { herramienta_id, nuevo_estado, codigo_qr_escaneado } = req.body;
    db.get('SELECT codigo_qr FROM herramientas WHERE id = ?', [herramienta_id], (err, row) => {
        if (err || !row || row.codigo_qr !== codigo_qr_escaneado) return res.status(400).json({ error: 'Validacion QR fallo' });
        db.serialize(() => {
            db.run('UPDATE pedidos_herramientas SET estado_pedido = "Finalizado" WHERE herramienta_id = ? AND estado_pedido != "Finalizado"', [herramienta_id]);
            db.run('UPDATE herramientas SET estado = ? WHERE id = ?', [nuevo_estado, herramienta_id], () => res.json({ message: 'Devolucion procesada.' }));
        });
    });
});

app.get('/api/herramientas', (req, res) => {
    const sql = `
        SELECT h.id, h.nombre, h.codigo_qr, h.estado, l.nombre AS ubicacion_actual
        FROM herramientas h
        LEFT JOIN pedidos_herramientas ph ON h.id = ph.herramienta_id AND ph.estado_pedido IN ('Pendiente', 'En traslado', 'Entregado')
        LEFT JOIN locaciones l ON ph.locacion_destino_id = l.id
    `;
    db.all(sql, [], (err, rows) => {
        const result = rows.map(row => ({ ...row, ubicacion_actual: row.ubicacion_actual || 'Almacen Central Cabudare' }));
        res.json(result);
    });
});

app.get('/movil', (req, res) => { res.sendFile(path.resolve(__dirname, '../frontend/mobile.html')); });
app.listen(PORT, () => console.log('Servidor operativo de Moravana en puerto ' + PORT));
