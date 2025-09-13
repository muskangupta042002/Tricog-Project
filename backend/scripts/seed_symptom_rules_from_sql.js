// Seed symptom_rules from the root SQL file symptom_rules_insert.sql
// Usage: npm run seed:symptoms-sql (from backend)

const fs = require('fs');
const path = require('path');
const db = require('../db');

(async () => {
  const sqlPath = path.join(__dirname, '../../symptom_rules_insert.sql');

  try {
    if (!fs.existsSync(sqlPath)) {
      console.error('SQL file not found at:', sqlPath);
      process.exit(1);
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');
    if (!sql || !sql.trim()) {
      console.error('SQL file appears empty:', sqlPath);
      process.exit(1);
    }

    console.log('Seeding symptom_rules from:', sqlPath);

    await db.transaction(async (client) => {
      await client.query(sql);
    });

    console.log('Seed completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  }
})();