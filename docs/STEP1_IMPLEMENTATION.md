# AI Agent WhatsApp Bot - Step 1 Implementation

## نظرة عامة
نظام AI Agent ذكي داخل بوت واتساب يعمل بـ Intent-Based Approach (بدون State Machine جامد).

## المميزات
- ✅ فهم الرسائل واستخراج البيانات تلقائياً
- ✅ دعم الصوت (STT و TTS)
- ✅ جمع بيانات العميل تدريجياً
- ✅ توليد PIN للحماية
- ✅ استعلام الراتب من ملفات مرفوعة
- ✅ تتبع استهلاك OpenAI

---

## كيف يعمل DM Flow

```
العميل يرسل رسالة DM
       │
       ▼
┌──────────────────────┐
│   DM Queue           │ ← معالجة تسلسلية لمنع Rate Limiting
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│   Voice Handler      │ ← إذا كانت رسالة صوتية: STT → نص
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│   AI Analyzer        │ ← تحليل الرسالة واستخراج:
│   (JSON Only)        │   - Intent (REGISTER, ASK_SALARY, etc.)
│                      │   - Extracted Fields
│                      │   - PIN Attempt
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│   Business Logic     │ ← النظام يقرر (وليس AI):
│                      │   - ماذا يحفظ
│                      │   - ماذا يسأل
│                      │   - متى يطلب PIN
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│   Reply Generator    │ ← توليد الرد النهائي
└──────────────────────┘
       │
       ▼
┌──────────────────────┐
│   Voice/Text Send    │ ← إذا كانت الرسالة الأصلية صوت: TTS
└──────────────────────┘
```

---

## كيف يعمل الصوت

### Speech-to-Text (STT)
1. تحميل ملف الصوت من واتساب
2. حفظه مؤقتاً في `temp/`
3. إرساله لـ OpenAI Whisper
4. الحصول على النص
5. معالجة النص كرسالة عادية

### Text-to-Speech (TTS)
1. توليد الرد النصي
2. إرساله لـ OpenAI TTS
3. حفظ الصوت كـ `.ogg`
4. إرساله كـ Voice Note في واتساب

---

## كيف يعمل PIN

### التوليد
- بعد اكتمال بيانات العميل
- PIN مكون من 6 أرقام عشوائية
- يتم تخزين Hash (SHA-256) فقط
- يُعطى للعميل مرة واحدة

### التحقق
- مطلوب لأي عملية حساسة (مثل الراتب)
- بعد التحقق: Trusted Session لمدة قابلة للتعديل (افتراضي 15 دقيقة)
- "نسيت الرمز": رسالة توجيه للإدارة (لا Reset تلقائي)

---

## كيف يعمل رفع الرواتب والاستعلام

### رفع Sheet
1. الأدمن يرفع ملف CSV من Dashboard
2. يختار:
   - اسم القسم (Period Name)
   - عمود ID
   - عمود الراتب
   - نسبة الوكالة
3. النظام يحفظ:
   - Metadata في `ai_salary_periods.json`
   - Data في `ai_salary_data/<periodId>.json`

### استعلام الراتب
1. العميل يسأل "كم راتبي"
2. التحقق من PIN/Session
3. البحث في آخر Period مرفوع
4. جمع رواتب كل IDs للعميل
5. عرض:
   - راتب كل ID
   - المجموع Gross
   - خصم الوكالة
   - الصافي Net

---

## الـ Endpoints الجديدة

### AI Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/settings` | الحصول على الإعدادات |
| POST | `/api/ai/settings` | تحديث الإعدادات |

### AI Clients
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/clients` | الحصول على كل العملاء |

### AI Usage
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/usage` | ملخص الاستهلاك |
| GET | `/api/ai/usage/log` | سجل العمليات (آخر 100) |
| POST | `/api/ai/usage/reset` | إعادة تعيين الإحصائيات |

### Salary Management
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai/salary/periods` | قائمة الأقسام |
| POST | `/api/ai/salary/upload` | رفع ملف رواتب |
| POST | `/api/ai/salary/upload/preview` | معاينة ملف قبل الرفع |
| DELETE | `/api/ai/salary/period/:id` | حذف قسم |
| POST | `/api/ai/salary/period/:id/current` | تعيين كقسم حالي |

---

## هيكل الملفات

```
src/ai_agent_v1/
├── index.js          # نقطة الدخول الرئيسية
├── dmQueue.js        # معالجة تسلسلية للـ DM
├── analyzer.js       # تحليل الرسائل (JSON only)
├── reply.js          # توليد الردود
├── voice.js          # STT و TTS
├── clients.js        # إدارة بيانات العملاء
├── pin.js            # توليد وتحقق PIN
├── salary.js         # إدارة الرواتب
└── usage.js          # تتبع الاستهلاك

data/
├── ai_settings.json        # إعدادات OpenAI
├── ai_clients.json         # بيانات العملاء
├── ai_salary_periods.json  # قائمة الأقسام
├── ai_salary_data/         # ملفات الرواتب
│   └── <periodId>.json
└── ai_usage_log.json       # سجل الاستهلاك

public/
└── ai-dashboard.html       # لوحة تحكم AI
```

---

## Validation Rules

| Field | Rule |
|-------|------|
| fullName | كلمتين على الأقل، يرفض "ممكن سوال" و "مرحبا" |
| address | تفصيلي (3 كلمات أو مؤشرات مكان) |
| phone | أرقام فقط، 8-15 رقم |
| ids | مصفوفة أرقام فقط |

---

## أمان

- ✅ API Key يُخزن في ملف منفصل (لا يظهر في responses)
- ✅ PIN يُخزن كـ Hash فقط
- ✅ لا يُطبع المفتاح في logs
- ✅ Trusted Session قابلة للتعديل

---

## التشغيل

1. تأكد من وجود `openai` في dependencies
2. شغل السيرفر: `npm start`
3. افتح Dashboard: `http://localhost:3000`
4. انتقل لـ AI Agent من القائمة
5. أدخل OpenAI API Key
6. فعّل AI Agent
7. ارفع ملف رواتب (اختياري)
8. جاهز للاستخدام!

---

## Acceptance Tests

| # | Test | Expected |
|---|------|----------|
| 1 | عميل جديد يرسل نص | رد محترم + سؤال واحد |
| 2 | عميل جديد يرسل صوت | STT → رد صوت + سؤال |
| 3 | "ممكن سوال" كاسم | يُرفض، يسأل مجدداً |
| 4 | اكتمال البيانات | توليد PIN وإعطاءه |
| 5 | "كم راتبي" بعد تسجيل | طلب PIN → الراتب |
| 6 | رفع Sheet من Dashboard | يظهر في قائمة الأقسام |
| 7 | Usage Dashboard | عدد العمليات + التكلفة |
