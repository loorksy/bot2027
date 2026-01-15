/**
 * Clear All Database Data
 * This script deletes all data from all tables while keeping the schema intact
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearDatabase() {
    console.log('🚀 Starting database cleanup...\n');

    try {
        await prisma.$connect();
        console.log('✅ Connected to database\n');

        // Delete in order (respecting foreign key constraints)
        console.log('🗑️  Deleting data from all tables...\n');

        // 1. Delete transactions first (may reference other tables)
        const txCount = await prisma.transaction.deleteMany({});
        console.log(`   ✅ Deleted ${txCount.count} transactions`);

        // 2. Delete salaries (references Period and User)
        const salaryCount = await prisma.salary.deleteMany({});
        console.log(`   ✅ Deleted ${salaryCount.count} salaries`);

        // 3. Delete reports (references Period)
        const reportCount = await prisma.report.deleteMany({});
        console.log(`   ✅ Deleted ${reportCount.count} reports`);

        // 4. Delete deferred items
        const deferredCount = await prisma.deferredItem.deleteMany({});
        console.log(`   ✅ Deleted ${deferredCount.count} deferred items`);

        // 5. Delete periods
        const periodCount = await prisma.period.deleteMany({});
        console.log(`   ✅ Deleted ${periodCount.count} periods`);

        // 6. Delete client IDs (references RegisteredClient)
        const clientIdCount = await prisma.clientId.deleteMany({});
        console.log(`   ✅ Deleted ${clientIdCount.count} client IDs`);

        // 7. Delete registered clients
        const clientCount = await prisma.registeredClient.deleteMany({});
        console.log(`   ✅ Deleted ${clientCount.count} registered clients`);

        // 8. Delete users
        const userCount = await prisma.user.deleteMany({});
        console.log(`   ✅ Deleted ${userCount.count} users`);

        // 9. Delete agencies
        const agencyCount = await prisma.agency.deleteMany({});
        console.log(`   ✅ Deleted ${agencyCount.count} agencies`);

        // 10. Delete companies
        const companyCount = await prisma.company.deleteMany({});
        console.log(`   ✅ Deleted ${companyCount.count} companies`);

        // 11. Delete settings
        const settingCount = await prisma.setting.deleteMany({});
        console.log(`   ✅ Deleted ${settingCount.count} settings`);

        console.log('\n🎉 Database cleanup completed successfully!');
        console.log('📊 Summary:');
        console.log(`   - Transactions: ${txCount.count}`);
        console.log(`   - Salaries: ${salaryCount.count}`);
        console.log(`   - Reports: ${reportCount.count}`);
        console.log(`   - Deferred Items: ${deferredCount.count}`);
        console.log(`   - Periods: ${periodCount.count}`);
        console.log(`   - Client IDs: ${clientIdCount.count}`);
        console.log(`   - Registered Clients: ${clientCount.count}`);
        console.log(`   - Users: ${userCount.count}`);
        console.log(`   - Agencies: ${agencyCount.count}`);
        console.log(`   - Companies: ${companyCount.count}`);
        console.log(`   - Settings: ${settingCount.count}`);

    } catch (error) {
        console.error('\n❌ Error during database cleanup:');
        console.error(error.message);
        if (error.code) {
            console.error(`   Error Code: ${error.code}`);
        }
        process.exit(1);
    } finally {
        await prisma.$disconnect();
        console.log('\n✅ Disconnected from database');
    }
}

// Run the cleanup
clearDatabase()
    .then(() => {
        console.log('\n✨ Done!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Fatal error:');
        console.error(error);
        process.exit(1);
    });

