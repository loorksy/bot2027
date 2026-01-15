const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function clearAll() {
    console.log('🗑️ Clearing database...');

    // Clear in order (respect foreign keys)
    await prisma.salary.deleteMany();
    console.log('  - Salaries deleted');

    await prisma.transaction.deleteMany();
    console.log('  - Transactions deleted');

    await prisma.deferredItem.deleteMany();
    console.log('  - Deferred Items deleted');

    await prisma.period.deleteMany();
    console.log('  - Periods deleted');

    await prisma.user.deleteMany();
    console.log('  - Users deleted');

    await prisma.agency.deleteMany();
    console.log('  - Agencies deleted');

    await prisma.company.deleteMany();
    console.log('  - Companies deleted');

    console.log('✅ Database cleared!');

    // Clear sheet files
    console.log('\n🗑️ Clearing sheet files...');
    const dataDir = path.join(__dirname, 'src/accounting/data');

    if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                fs.unlinkSync(path.join(dataDir, file));
                console.log('  - Deleted:', file);
            }
        }
    }

    console.log('✅ Sheet files cleared!');
    console.log('\n🎉 All data has been reset. Ready for fresh testing!');

    await prisma.$disconnect();
}

clearAll().catch(e => {
    console.error('Error:', e.message);
    prisma.$disconnect();
});
