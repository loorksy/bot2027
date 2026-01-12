# مرجع نظام المحاسبة (Soulchill Agency ERP)

**الهدف:** بناء نظام ERP مالي/جرد متعدد الأقسام لوكيل Soulchill الرئيسي.

## 0. سياق العمل (Domain Story)
- **الوكيل الرئيسي:** هو المركز المالي، يستلم الأموال من التطبيق (Soulchill) وشركة التوثيق.
- **القسم (Payroll Period):** دورة مالية كل 15 يوم.
- **مصادر الدخل:**
    - رواتب المضيفين (يتم خصم 7% منها لصالح الوكيل الرئيسي).
    - أرباح الوكالات الفرعية (نسبة متغيرة).
    - أرباح الاعتمادات (وكالات أخرى تستلم عبرنا).
    - مبيعات الشحن (Coins/Gold).
    - فرق التصريف (Exchange Rate Diff).
- **التدفق المالي:**
    - استلام الأموال -> صندوق الشركات.
    - توزيع الرواتب (مضيفين، فرعيين، معتمدين).
    - خصم الديون (ديون شحن، سلف).
    - تسليم الرواتب (عبر موثوقين أو شركات تحويل).

11. **Staff:** مشرفين، مسوقين، موثوقين.
12. **System:** إعدادات، مستخدمين، صلاحيات.

### Stage 3: Salaries, Deferred & Payouts (See Design)

### Stage 4: Sub-Agents & Accredited Logic

#### 1. Sub-Agents
*   **Profit Calculation**: `SubAgent Profit = Agency Ratio * Sum(User Salaries in SubAgent)`.
*   **Main Agent Profit**: `Main Profit = Main Rate * SubAgent Profit`.
*   **Workflow**:
    1.  User adds Sub-Agent (User Type).
    2.  Assigns Users to Sub-Agent (via `subAgentId` in User Profile).
    3.  In Accounting > Sub-Agents: Click "Calculate" for a period.
    4.  System sums all salaries for that Sub-Agent's users.
    5.  Applies Ratio defined in `sub_agents_data`.
    6.  Result displayed and can be "Confirmed" (saved to Period Stats).

#### 2. Accredited Agencies (External)
*   Agencies that send work/money to Main Agent.
*   **Settlement**:
    1.  Total Incoming Amount from Accredited.
    2.  Minus Total Salaries for their hosts.
    3.  Minus Main Agent Commission (`Fixed Rate` or `Tiered`).
    4.  Result = Net Profit for Accredited.
*   **Debts**:
    *   If Accredited owes money (e.g. for Shipping coverage), it is recorded in `accredited_debts`.
    *   During Settlement, "Auto-Deduct" checks for open debts and subtracts from Net Profit.

#### 3. Accredited Operations
*   **Add Debt**: Manual entry (Amount, Reason, Date).
*   **Settle**: Create a settlement record for a period.
*   **Transfer Deferred**: Move remaining balance to next period if not paid.

### Stage 5: Shipping & Finance (Brief)
*   **Shipping**: Inventory-based. Deducts from `shipping_packages`. Can be paid via `Cash`, `Debt` (User Debt), or `Salary` (Deduct from Salary).
*   **Company Wallet**: Track real money moves (Bank, Cash, Transfer Companies).
*   **FX**: Track Rate A vs Rate B differences as Profit/Loss.

## 3. الكيانات والعلاقات (ERD Concept)

### Core
- **Period:** `(id, name, startDate, endDate, status, totalIncoming, totalSalaries, totalProfit)`
- **User:** `(id, name, type=[Host, SubAgent, Accredited, Supervisor, Marketer, Trusted], phone, profileData)`

### Financials
- **Salary:** `(id, periodId, userId(Host), amountCurrency, amountUSD, status=[Unpaid, Paid, Deferred, ToShipping])`
- **SubAgentProfit:** `(id, periodId, userId(SubAgent), totalSalaries, agencyPercent, agencyProfit, mainAgentProfit)`
- **AccreditedSettlement:** `(id, periodId, userId(Accredited), incomingAmount, distributedAmount, agentProfit, mainAgentProfit)`
- **DeferredItem:** `(id, sourcePeriodId, targetPeriodId, userId, amount, reason)`

### Shipping
- **Package:** `(id, name, type=[Coins, Gold], quantity, costPrice, sellPrice)`
- **Inventory:** `(id, type, currentBalance)`
- **Shipment:** `(id, userId, packageId, quantity, totalCost, totalSell, profit, paymentMethod=[Cash, Debt, FromSalary])`
- **ShippingDebt:** `(id, userId, amount, reason, date, status)`

### Wallets & Exchange
- **CompanyWallet:** `(id, companyName, balance, currency)`
- **Transaction:** `(id, walletId, type=[Deposit, Withdraw], amount, date, description)`
- **ExchangeRate:** `(id, periodId, rateType=[Accounting, Payment], rate)`

## 3. ملفات بيانات المستخدمين (User Data Profiles)
يتم استخدام نموذج موحد لإنشاء المستخدمين، وتظهر الحقول بناءً على النوع المختار:

### 1. مضيف (Host)
- `id` (رقم الهوية/ID)
- الاسم الكامل
- اسم الوكالة
- العنوان
- رقم الواتساب
- ملاحظة

### 2. وكيل فرعي (Sub-Agent)
- `id`
- `room_id`
- كود التفعيل
- عدد المستخدمين
- رقم الواتساب
- نسبة الوكالة (%)
- إجمالي مبلغ الوكالة
- اسم الوكالة
- ملاحظة

### 3. معتمد (Accredited)
- `id`
- اسم المعتمد
- رقم الواتساب
- المبلغ (اختياري)
- التاريخ (اختياري - تاريخ البدء/الاعتماد)
- عدد المستخدمين
- الدول
- العنوان
- ملاحظة

### 4. شخص موثوق (Trusted Person)
- `id`
- الاسم الكامل
- العنوان
- رقم الواتساب
- الراتب (شهري/كل قسم)
- ملاحظة
*(ممنوع رفع وثائق)*

### 5. مشرف (Supervisor)
- `id`
- الاسم
- نوع الإشراف (مشرف وكالة / مشرف واتساب)
- الراتب (شهري/كل قسم)
- رقم الواتساب
- ملاحظة

### 6. مسوق (Marketer)
- `id`
- الاسم
- رقم الواتساب
- عدد الأشخاص
- طرق التسويق (فيسبوك، انستجرام، واتساب، غير ذلك)
- راتب التسويق (حسب عدد الأشخاص)
- ربح كل عميل
- ملاحظة

### 6.4 إدارة الرواتب (Salaries Management) - Stage 3
**حالات الراتب (Status):**
- **Unpaid (غير مدفوع):** الحالة الافتراضية.
- **Paid (مدفوع):** تم تسجيل الدفع (يولد حركة في `salary_payments`).
- **Deferred (مؤجل):** تم ترحيله لقسم آخر (يولد سجل في `deferred_items`).
- **Converted (تحويل شحن):** تم تحويل المبلغ لرصيد coins (يولد حركة شحن `ShipmentOp`).

**أزرار التحكم (Salaries Actions):**
- `[+ إضافة راتب]`
- `[استيراد]` (Excel)
- `[تطبيق خصم 7%]` (لكل القائمة أو محدد)
- `[دفع]` (Set as Paid)
- `[ترحيل للمؤجل]` (Move to Deferred)
- `[تحويل لشحن]` (Convert to Coins)
- `[طباعة]`

### 6.5 إدارة المؤجل (Deferred Management)
ينقسم إلى قسمين:
1.  **مؤجل الوكالة الرئيسية:** رواتب أو مستحقات تم تأجيلها.
2.  **مؤجل الاعتمادات:** ديون أو مستحقات وكلاء معتمدين.

**العمليات:**
- `[ترحيل للقسم القادم]` (نقل التاريخ)
- `[دفع الآن]` (تحويل إلى مصروف في القسم الحالي)
- `[تعديل تاريخ الاستحقاق]`

### 6.6 مدفوعات المشرفين والمسوقين (Payouts)
**المشرفين (Supervisors):**
- راتب ثابت أو متغير.
- زر: `[احتساب راتب]` (يدوياً أو تلقائياً بناءً على القواعد).
- زر: `[دفع]`

**المسوقين (Marketers):**
- يعتمد على: عدد العملاء الجدد × الربح لكل عميل.
- زر: `[تسجيل عميل جديد]`
- زر: `[احتساب العمولة]`
- زر: `[دفع]`وقت الدفع الفعلي.

## 5. واجهات المستخدم (UI Plan)
*سيتم تصميم الواجهات بناءً على المتطلبات التفصيلية في طلب المستخدم.*

---
**تم إنشاء هذا الملف بناءً على طلب المستخدم في 2026-01-11**
