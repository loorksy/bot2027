/**
 * Gender Detector from Arabic Names
 * Detects gender from Arabic first names
 */

// Common male names in Arabic
const MALE_NAMES = [
    'أحمد', 'محمد', 'علي', 'حسن', 'حسين', 'عمر', 'خالد', 'سعيد', 'عبد', 'يوسف',
    'إبراهيم', 'موسى', 'عيسى', 'داود', 'سليمان', 'إسماعيل', 'يعقوب', 'أيوب',
    'زكريا', 'يحيى', 'عثمان', 'طارق', 'وليد', 'ماجد', 'فهد', 'سالم', 'راشد',
    'ناصر', 'منصور', 'بدر', 'أسامة', 'أسامه', 'حمزة', 'حمزه', 'سامي', 'وائل',
    'جمال', 'كمال', 'نبيل', 'بلال', 'عماد', 'إياد', 'زياد', 'مراد', 'فراس',
    'باسل', 'عادل', 'فيصل', 'هيثم', 'معاذ', 'معاد', 'عبدالله', 'عبدالرحمن',
    'عبدالعزيز', 'عبدالكريم', 'عبدالمجيد', 'عبدالرحيم', 'عبدالحميد',
    'جاسم', 'حامد', 'رامي', 'سامر', 'صالح', 'صلاح', 'طلال', 'عامر', 'غازي',
    'غسان', 'فادي', 'فارس', 'قاسم', 'كريم', 'ماهر', 'مازن', 'محمود', 'مصطفى',
    'نادر', 'نبيه', 'هاني', 'وسام', 'ياسر', 'يزيد', 'انس', 'أنس', 'بشار', 'تميم',
    'جابر', 'حاتم', 'رائد', 'رشيد', 'سفيان', 'شادي', 'صهيب', 'ضياء', 'عز',
    'عزام', 'عصام', 'علاء', 'فؤاد', 'فهمي', 'مالك', 'ملك', 'نايف', 'هشام',
    'هاشم', 'يامن', 'ياسين', 'احمد', 'عبدو', 'ابو', 'أبو', 'ابي', 'أبي'
];

// Common female names in Arabic
const FEMALE_NAMES = [
    'فاطمة', 'فاطمه', 'عائشة', 'عائشه', 'خديجة', 'خديجه', 'زينب', 'مريم', 'سارة', 'ساره',
    'نور', 'هدى', 'هند', 'ليلى', 'ليلا', 'سلمى', 'سلما', 'رقية', 'رقيه', 'حفصة', 'حفصه',
    'آمنة', 'آمنه', 'أم', 'ام', 'بنت', 'أميرة', 'اميره', 'جميلة', 'جميله', 'حليمة', 'حليمه',
    'خولة', 'خوله', 'رحمة', 'رحمه', 'سعاد', 'سمية', 'سميه', 'شيماء', 'صفية', 'صفيه',
    'عزة', 'عزه', 'لينا', 'لينه', 'منى', 'منا', 'نادية', 'ناديه', 'نجوى', 'هالة', 'هاله',
    'وفاء', 'ياسمين', 'ياسمينه', 'إيمان', 'ايمان', 'أسماء', 'اسماء', 'جنى', 'جنا',
    'حنان', 'حنين', 'دانة', 'دانه', 'رؤى', 'روى', 'رولا', 'رولى', 'رنا', 'رند',
    'ريم', 'شهد', 'غادة', 'غاده', 'فريدة', 'فريده', 'لطيفة', 'لطيفه', 'ملاك',
    'نادين', 'نهى', 'هيا', 'هيام', 'وردة', 'ورده', 'يارا', 'ياره', 'بسمة', 'بسمه',
    'تسنيم', 'جود', 'دعاء', 'راما', 'رانيا', 'رزان', 'سجى', 'سجا', 'سديم', 'سلوى', 'سلوا',
    'شروق', 'شيرين', 'صبا', 'ضحى', 'علياء', 'غيداء', 'فجر', 'لمى', 'لما', 'مها', 'ميساء',
    'ميسون', 'نورا', 'نوره', 'هيفاء', 'هيفا', 'هبة', 'هبه'
];

/**
 * Detect gender from Arabic name
 * @param {string} fullName - Full name (usually first name is enough)
 * @returns {string} - 'male', 'female', or 'unknown'
 */
function detectGender(fullName) {
    if (!fullName || typeof fullName !== 'string') {
        return 'unknown';
    }
    
    // Clean and get first name
    const cleaned = fullName.trim();
    const firstName = cleaned.split(/\s+/)[0];
    
    // Check if it's a male name
    if (MALE_NAMES.some(name => firstName.includes(name) || name.includes(firstName))) {
        return 'male';
    }
    
    // Check if it's a female name
    if (FEMALE_NAMES.some(name => firstName.includes(name) || name.includes(firstName))) {
        return 'female';
    }
    
    // Default to unknown
    return 'unknown';
}

/**
 * Get appropriate greeting based on gender and name
 * @param {string} fullName - Full name
 * @param {string} defaultGender - Default gender if detection fails ('male' or 'female')
 * @returns {object} - { gender: 'male'|'female', greeting: 'حبيبي'|'حبيبتي' }
 */
function getGreeting(fullName, defaultGender = 'female') {
    const detected = detectGender(fullName);
    const gender = detected === 'unknown' ? defaultGender : detected;
    
    return {
        gender: gender,
        greeting: gender === 'male' ? 'حبيبي' : 'حبيبتي',
        greetingFormal: gender === 'male' ? 'عزيزي' : 'عزيزتي'
    };
}

module.exports = {
    detectGender,
    getGreeting,
    MALE_NAMES,
    FEMALE_NAMES
};
