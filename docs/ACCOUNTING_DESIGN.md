# تصميم نظام محاسبة الوكيل (Accounting Design Doc)

### Database Schema (JSON Files)

#### `users.json`
Stores all user types (Host, SubAgent, Accredited, Supervisor, Marketer).

#### `periods.json`
Stores 15-day financial cycles.

#### `salaries.json`
Stores individual salary records linked to periods.

#### `deferred_items.json`
Stores deferred payments (Agency or Accredited).

#### Stage 4 Collections:
*   `sub_agents_data.json`: Extra data for sub-agents (rates, specific configs).
*   `accredited_data.json`: Extra data for authenticated agencies (rates, contact).
*   `accredited_debts.json`: Debts records for accredited agencies.
*   `accredited_settlements.json`: Settlement records per period.

#### Stage 5 Collections:
*   `shipping_packages.json`: Defined packages and inventory count.
*   `shipping_operations.json`: Log of all shipping transactions (Cash, Debt, Salary).
*   `companies.json`: Company profiles (e.g., Transfer companies).
*   `company_wallet.json`: Wallet transactions for companies.
*   `fx_rates.json`: Exchange rate snapshots.
*   `trusted_people.json`: Manual delivery logs.

### 1. Users Collection (`users.json`)
Stores all user types with dynamic fields supported by the application logic.

**Core Fields (All Types):**
- `id` (String): Unique Identifier (Host ID or Generated).
- `type` (Enum): `Host`, `SubAgent`, `Accredited`, `Trusted`, `Supervisor`, `Marketer`.
- `name` (String): Full Name / Agency Name.
- `phone` (String): WhatsApp Number.
- `note` (String): Optional notes.
- `createdAt` (Timestamp).

**Type-Specific Fields (in `data` object or root):**
- **Host:** `agencyName`, `address`.
- **SubAgent:** `roomId`, `activationCode`, `userCount`, `agencyRatio`, `totalAgencyAmount`, `agencyName`.
- **Accredited:** `amount` (optional), `startDate`, `userCount`, `countries`, `address`.
- **Trusted:** `salary`, `salaryType` (Monthly/Period), `address`.
- **Supervisor:** `supervisionType` (Agency/WhatsApp), `salary`, `salaryType`.
- **Marketer:** `marketingMethods` (Array), `marketingSalary`, `profitPerClient`, `userCount`.

## 1. ERD (Entity Relationship Diagram)

```mermaid
erDiagram
    PERIOD {
        string id PK
        string name "مثال: قسم 15-2026"
        date startDate
        date endDate
        enum status "OPEN, CLOSED, LOCKED"
        float exchangeRate
        float deductionRate
        float totalIncoming "وارد التطبيق"
        float totalSalaries "مجموع الرواتب"
        float netProfit
        float totalLiabilities
        float totalAssets
        string notes
        timestamp createdAt
        timestamp closedAt
    }

    USER {
        string id PK
        string fullName
        enum type "Host,SubAgent,Accredited,Supervisor,Marketer,Trusted"
        string phone
        string agencyName "للمضيفين والفرعيين"
        float totalIncome "مجموع دخل تاريخي"
    }

    SALARY {
        string id PK
        string periodId FK
        string userId FK "Host ID"
        float amountBase "راتب أساسي"
        float amountUSD "بالدولار"
        float deduction "خصم 7%"
        enum status "Unpaid, Paid, Deferred, ToShipping"
        string relatedShipmentId FK "إذا تم تحويله لشحن"
    }

    SUB_AGENT_PROFIT {
        string id PK
        string periodId FK
        string userId FK "SubAgent ID"
        float totalAgencySalaries
        float agencyPercent "% نسبة الوكالة"
        float agencyProfit "ربح الوكالة الفرعية"
        float mainAgentShare "% حصة الوكيل الرئيسي"
        float mainAgentProfit "ربح الوكيل الرئيسي"
    }

    COMPANY_WALLET {
        string id PK
        string name "اسم شركة التحويل"
        float balance
        string currency
    }

    TRANSACTION {
        string id PK
        string walletId FK
        enum type "Deposit, Withdraw, Transfer"
        float amount
        string description
        date date
    }

    SHIPMENT {
        string id PK
        string userId FK "Customer"
        string packageId FK
        float quantity
        float sellPrice
        float costPrice
        float profit
        enum paymentMethod "Cash, Debt, Salary"
        string linkedSalaryId FK "إذا من راتب"
    }

    PERIOD ||--o{ SALARY : contains
    PERIOD ||--o{ SUB_AGENT_PROFIT : contains
    USER ||--o{ SALARY : receives
    USER ||--o{ SHIPMENT : performs
    COMPANY_WALLET ||--o{ TRANSACTION : has

## 2. API Endpoints

### 4. Salaries Collection (`salaries.json`)
- `id` (PK)
- `periodId` (FK)
- `userId` (FK)
- `amountBase`: Number (المبلغ الأصلي)
- `deductionRate`: Number (0 or 7%)
- `deductionAmount`: Number
- `netAmount`: Number (الصافي)
- `status`: Enum (`UNPAID`, `PAID`, `DEFERRED`, `CONVERTED`)
- `paymentId`: FK (nullable, if paid)
- `shipmentId`: FK (nullable, if converted)
- `notes`: String

### 5. Deferred Items (`deferred_items.json`)
- `id` (PK)
- `originPeriodId` (FK - القسم الأصلي)
- `targetPeriodId` (FK - القسم المستهدف/القادم)
- `userId` (FK)
- `type`: Enum (`AGENCY`, `ACCREDITED`)
- `amount`: Number
- `description`: String
- `status`: Enum (`PENDING`, `SETTLED`)

### 6. Payouts (Supervisors/Marketers)
- `id` (PK)
- `periodId` (FK)
- `userId` (FK)
- `type`: Enum (`SUPERVISOR`, `MARKETER`)
- `amount`: Number
- `details`: JSON (calc logic e.g., client count * rate)
- `status`: Enum (`UNPAID`, `PAID`)

### 4. API Endpoints
#### Periods (Stage 2)
- `POST /periods`: Create new period.
- `GET /periods`: List all periods (summary).
- `GET /periods/:id`: Get full details.
- `PUT /periods/:id`: Update basic info.
- `POST /periods/:id/import`: Import Soulchill data.
- `POST /periods/:id/settle`: Run calculations.
- `POST /periods/:id/close`: Close period.

#### Salaries (Stage 3)
- `GET /salaries`: List (filter by period).
- `POST /salaries`: Add single salary.
- `PUT /salaries/:id`: Update.
- `POST /salaries/apply-deduction`: Apply 7% to selection/all.
- `POST /salaries/:id/pay`: Mark as paid.
- `POST /salaries/:id/defer`: Move to deferred.
- `POST /salaries/:id/convert`: Convert to shipping.

#### Deferred & Payouts (Stage 3)
- `GET /deferred`: List items.
- `POST /deferred`: Create manual deferred item.
- `POST /payouts/calculate`: Auto-calc for Supervisor/Marketer.
- `POST /payouts`: Save payout record.إنشاء قسم
- `GET /api/accounting/periods/:id/summary` - ملخص مالي
- `POST /api/accounting/periods/:id/close` - إغلاق القسم

### 2.2 Salaries (الرواتب)
- `GET /api/accounting/salaries?periodId=xyz` - عرض رواتب قسم
- `POST /api/accounting/salaries/import` - استيراد CSV
- `POST /api/accounting/salaries/convert-fishing` - تحويل لشحن
- `PUT /api/accounting/salaries/:id/status` - تغيير حالة (دفع/تأجيل)

### 2.3 Shipping (الشحن)
- `POST /api/accounting/shipping/new` - عملية شحن جديدة
- `GET /api/accounting/shipping/pkgs` - قائمة الباقات
- `GET /api/accounting/shipping/inventory` - المخزون

### 2.4 Reports (التقارير)
- `GET /api/accounting/reports/main-agent` - ربح الوكيل الرئيسي
- `GET /api/accounting/reports/sub-agents` - كشف فرعيين

## 3. UI Wireframes (نصي)

### Dashboard
- **Header:** KPIs (Total Income, Total Salaries, Net Profit).
- **Body:** Grid of recent Periods.
- **Sidebar:** Navigation (Periods, Salaries, Shipping, Wallets...).

### Salaries Screen
- **Toolbar:** Import | Export | Convert to Shipping | Defer Selected
- **Table:**
  - ID | Name | Agency | Amount ($) | Status | Actions
  - 123 | Ahmed | Moon | $500 | [Button: Pay] | [Button: Convert] (Drop down actions)

### Shipping Screen
- **Form:** Select User -> Select Package -> Payment Method (Cash/Debt/Salary).
- **Summary:** Total Sold Today | Profit Today.

## 4. Rules Engine (قواعد الحسابات)

1.  **Main Agent Net Profit:**
    ```js
    Profit = (HostSalaries * 0.07) 
           + Sum(SubAgentProfits * MainAgentShare%) 
           + ShippingProfit 
           + ExchangeDiff 
           - OperationalCosts
    ```

2.  **Salary to Shipping Conversion:**
    - Input: `SalaryID`, `PackageID`
    - Action:
        - Deduct Package Cost from Inventory.
        - Create Shipment Record (Profit = SellPrice - Cost).
        - Update Salary Status -> `ToShipping`.
        - Do NOT deduct from CompanyWallet (since no cash out).

3.  **Sub-Agent Settlement:**
    - Input: `TotalSalaries`, `AgencyPercent`
    - Output: `SubAgentProfit`
    - Dues: `SubAgentProfit` - `MainAgentShare` - `PreviousDebts`

## 5. Implementation Strategy (MVP)
1.  **Stage 1:** Core Data (Users, Periods).
2.  **Stage 2:** Salaries & 7% Rule.
3.  **Stage 3:** Shipping module simple flow.
4.  **Stage 4:** Reports.
