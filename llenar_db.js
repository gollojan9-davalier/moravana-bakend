const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../../database/moravana.db');
const schemaPath = path.resolve(__dirname, '../../database/schema.sql');

console.log('Ruta de Base de Datos:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) return console.error(err.message);
    
    // Leer el esquema original e inicializar tablas
    try {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        db.serialize(() => {
            // Ejecutar la creaci?n de tablas separando por punto y coma
            schema.split(';').forEach(query => {
                if (query.trim()) db.run(query);
            });
            
            // Limpiar datos previos si existieran
            db.run('DELETE FROM herramientas; DELETE FROM materiales; DELETE FROM locaciones; DELETE FROM materiales_stock; DELETE FROM pedidos_herramientas;');

            // Insertar los datos limpios para Inversiones Moravana
            db.run("INSERT INTO locaciones (id, nombre, tipo, direccion) VALUES (1, 'Almacen Principal Central', 'Almacen Central', 'Sede Central Moravana'), (2, 'Residencias Los Samanes (Aptos)', 'Deposito Temporal', 'Zona Norte'), (3, 'Mantenimiento Planta Industrial X', 'Obra Corta', 'Zona Industrial')");
            db.run("INSERT INTO materiales (id, nombre, unidad_medida, stock_minimo_alerta) VALUES (1, 'Cemento Gris Premium', 'Sacos', 20), (2, 'Pego Gris', 'Sacos', 15), (3, 'Tubo PVC 1/2 agua blanca', 'Tubos', 10), (4, 'Disco de Corte Esmeril 4-1/2', 'Unidades', 25)");
            db.run("INSERT INTO herramientas (id, nombre, codigo_qr, estado) VALUES (1, 'Esmeril Angular Shure 4-1/2', 'QR-ESM-001', 'Disponible'), (2, 'Esmeril Angular Shure 4-1/2 (B)', 'QR-ESM-002', 'Taller'), (3, 'Taladro Percutor Dewalt 20V', 'QR-TAL-001', 'Disponible')");
            db.run("INSERT INTO materiales_stock (material_id, locacion_id, cantidad_actual) VALUES (1, 1, 50), (4, 1, 12)");

            console.log('--- [OK] Base de datos creada y alimentada con ?xito ---');
        });
    } catch (e) {
        console.error('Error al leer el archivo schema.sql:', e.message);
    }
});
