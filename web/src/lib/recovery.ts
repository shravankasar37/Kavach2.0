// Recovery plan after a scam: decided by code from the facts, never by the model. Text in English, Hindi, Marathi.
// Sources: National Cyber Crime Reporting Portal / 1930 (MHA I4C), Sanchar Saathi Chakshu (DoT),
// RBI circular "Customer Protection - Limiting Liability of Customers in Unauthorised Electronic Banking
// Transactions" (6 July 2017): zero liability if a third-party fraud is reported within 3 working days.
import type { Lang } from "./i18n";

export type Facts = {
  lostMoney: boolean;
  amount?: number | null;
  hoursAgo?: number | null;
  paidVia?: "upi" | "card" | "netbanking" | "wallet" | "other" | null;
  sharedOtpOrPin?: boolean;
  installedApp?: boolean;
  bank?: string | null;
};

export type Step = { id: string; title: string; detail: string; urgent?: boolean; action?: { label: string; href: string } };

type Text = { title: string; detail: string; action?: string };
const T: Record<Lang, Record<string, Text>> = {
  en: {
    call1930: { title: "Call 1930 now", detail: "1930 is the national cyber-fraud helpline. Reporting quickly lets the police ask the receiving bank to freeze the money before it moves on. Keep your bank name, the transaction ID (UTR) and the amount ready.", action: "Call 1930" },
    call1930late: { title: "Call 1930 now", detail: "Call 1930 even though some time has passed: the money can still be traced and frozen further along. Keep your bank name, transaction ID (UTR) and amount ready.", action: "Call 1930" },
    portal: { title: "File a complaint on cybercrime.gov.in", detail: "Choose 'Report Financial Fraud'. Paste the incident description below and attach screenshots of the message and the debit SMS. Note the acknowledgement number.", action: "Open cybercrime.gov.in" },
    bank: { title: "Block your {what} and tell {bank}", detail: "Call the number on the back of your card or in your bank's official app, never a number from the scam message. Ask them to block it and raise a fraud dispute, and send the letter below. Under RBI's 2017 rules your liability is zero if a fraud you didn't cause is reported within 3 working days." },
    app: { title: "Remove the app the scammer asked you to install", detail: "Turn off mobile data and Wi-Fi, uninstall any screen-sharing app (AnyDesk, TeamViewer, QuickSupport) or unknown app, and change your banking passwords from another phone. If you can't remove it, back up your photos and factory-reset the phone." },
    secrets: { title: "Change your UPI PIN, net-banking password and card PIN", detail: "Do it from your bank's official app. An OTP or PIN you shared can be misused until it is changed." },
    chakshu: { title: "Report the number on Sanchar Saathi (Chakshu)", detail: "The Department of Telecom uses these reports to block fraudsters' numbers and phones.", action: "Open Sanchar Saathi" },
    ignore: { title: "Don't reply, click or call back", detail: "Block the sender and delete the message. Real banks, India Post, power companies and TRAI never ask for an OTP, KYC update or payment through a link in SMS or WhatsApp." },
    fir: { title: "Register an FIR if the amount is large", detail: "Take the cybercrime.gov.in acknowledgement to your nearest police station or cyber cell. NyayaSathi can draft the complaint for you.", action: "Draft with NyayaSathi" },
  },
  hi: {
    call1930: { title: "अभी 1930 पर कॉल करें", detail: "1930 राष्ट्रीय साइबर धोखाधड़ी हेल्पलाइन है। जल्दी शिकायत करने पर पुलिस पैसे पाने वाले बैंक से रकम आगे जाने से पहले रुकवा सकती है। बैंक का नाम, ट्रांज़ैक्शन ID (UTR) और रकम तैयार रखें।", action: "1930 पर कॉल करें" },
    call1930late: { title: "अभी 1930 पर कॉल करें", detail: "समय बीत गया हो तब भी 1930 पर कॉल करें: पैसे का आगे भी पता लगाकर रोका जा सकता है। बैंक का नाम, ट्रांज़ैक्शन ID (UTR) और रकम तैयार रखें।", action: "1930 पर कॉल करें" },
    portal: { title: "cybercrime.gov.in पर शिकायत दर्ज करें", detail: "'Report Financial Fraud' चुनें। नीचे दिया गया विवरण पेस्ट करें और मैसेज व पैसे कटने वाले SMS के स्क्रीनशॉट लगाएँ। शिकायत नंबर (acknowledgement) लिख लें।", action: "cybercrime.gov.in खोलें" },
    bank: { title: "अपना {what} ब्लॉक करें और {bank} को बताएँ", detail: "कार्ड के पीछे या बैंक के आधिकारिक ऐप में दिए नंबर पर कॉल करें, धोखेबाज़ के मैसेज वाले नंबर पर कभी नहीं। ब्लॉक करवाएँ, धोखाधड़ी की शिकायत (dispute) दर्ज करवाएँ और नीचे दिया पत्र भेजें। RBI के 2017 के नियम के अनुसार, जिस धोखाधड़ी में आपकी गलती नहीं, उसकी सूचना 3 कार्य-दिवसों में देने पर आपका नुकसान शून्य होता है।" },
    app: { title: "धोखेबाज़ के कहने पर इंस्टॉल किया ऐप हटाएँ", detail: "मोबाइल डेटा और Wi-Fi बंद करें, स्क्रीन-शेयरिंग ऐप (AnyDesk, TeamViewer, QuickSupport) या अनजान ऐप हटाएँ, और दूसरे फ़ोन से बैंकिंग पासवर्ड बदलें। ऐप न हटे तो फ़ोटो का बैकअप लेकर फ़ोन फ़ैक्टरी-रीसेट करें।" },
    secrets: { title: "UPI PIN, नेट-बैंकिंग पासवर्ड और कार्ड PIN बदलें", detail: "यह बैंक के आधिकारिक ऐप से करें। बताया गया OTP या PIN बदलने तक गलत इस्तेमाल हो सकता है।" },
    chakshu: { title: "संचार साथी (चक्षु) पर नंबर की शिकायत करें", detail: "दूरसंचार विभाग इन शिकायतों से धोखेबाज़ों के नंबर और फ़ोन ब्लॉक करता है।", action: "संचार साथी खोलें" },
    ignore: { title: "जवाब न दें, लिंक न खोलें, वापस कॉल न करें", detail: "भेजने वाले को ब्लॉक करें और मैसेज डिलीट करें। असली बैंक, इंडिया पोस्ट, बिजली कंपनी और TRAI कभी SMS या WhatsApp लिंक से OTP, KYC या पैसे नहीं माँगते।" },
    fir: { title: "रकम बड़ी हो तो FIR दर्ज कराएँ", detail: "cybercrime.gov.in का शिकायत नंबर लेकर नज़दीकी थाने या साइबर सेल जाएँ। NyayaSathi आपकी शिकायत लिख सकता है।", action: "NyayaSathi से लिखवाएँ" },
  },
  mr: {
    call1930: { title: "आत्ताच 1930 वर कॉल करा", detail: "1930 ही राष्ट्रीय सायबर फसवणूक हेल्पलाइन आहे. लवकर तक्रार केल्यास पोलीस पैसे पुढे जाण्याआधी ते मिळालेल्या बँकेत गोठवू शकतात. बँकेचे नाव, व्यवहार ID (UTR) आणि रक्कम तयार ठेवा.", action: "1930 वर कॉल करा" },
    call1930late: { title: "आत्ताच 1930 वर कॉल करा", detail: "वेळ गेला असला तरी 1930 वर कॉल करा: पैशांचा पुढेही माग काढून ते गोठवता येतात. बँकेचे नाव, व्यवहार ID (UTR) आणि रक्कम तयार ठेवा.", action: "1930 वर कॉल करा" },
    portal: { title: "cybercrime.gov.in वर तक्रार नोंदवा", detail: "'Report Financial Fraud' निवडा. खालील वर्णन पेस्ट करा आणि संदेश व पैसे कापल्याच्या SMS चे स्क्रीनशॉट जोडा. तक्रार क्रमांक (acknowledgement) लिहून ठेवा.", action: "cybercrime.gov.in उघडा" },
    bank: { title: "तुमचे {what} ब्लॉक करा आणि {bank} ला कळवा", detail: "कार्डच्या मागे किंवा बँकेच्या अधिकृत ॲपमधील क्रमांकावर कॉल करा, फसवणुकीच्या संदेशातील क्रमांकावर कधीच नाही. ब्लॉक करायला सांगा, फसवणुकीची तक्रार (dispute) नोंदवा आणि खालील पत्र पाठवा. RBI च्या 2017 च्या नियमानुसार, ज्या फसवणुकीत तुमची चूक नाही तिची माहिती 3 कामकाजाच्या दिवसांत दिल्यास तुमचे नुकसान शून्य असते." },
    app: { title: "फसवणूक करणाऱ्याने सांगितलेले ॲप काढून टाका", detail: "मोबाइल डेटा आणि Wi-Fi बंद करा, स्क्रीन-शेअरिंग ॲप (AnyDesk, TeamViewer, QuickSupport) किंवा अनोळखी ॲप काढा, आणि दुसऱ्या फोनवरून बँकिंग पासवर्ड बदला. ॲप निघत नसेल तर फोटोंचा बॅकअप घेऊन फोन फॅक्टरी-रीसेट करा." },
    secrets: { title: "UPI PIN, नेट-बँकिंग पासवर्ड आणि कार्ड PIN बदला", detail: "हे बँकेच्या अधिकृत ॲपमधून करा. सांगितलेला OTP किंवा PIN बदलेपर्यंत त्याचा गैरवापर होऊ शकतो." },
    chakshu: { title: "संचार साथी (चक्षु) वर क्रमांकाची तक्रार करा", detail: "दूरसंचार विभाग या तक्रारींवरून फसवणूक करणाऱ्यांचे क्रमांक आणि फोन ब्लॉक करतो.", action: "संचार साथी उघडा" },
    ignore: { title: "उत्तर देऊ नका, लिंक उघडू नका, परत कॉल करू नका", detail: "पाठवणाऱ्याला ब्लॉक करा आणि संदेश डिलीट करा. खऱ्या बँका, इंडिया पोस्ट, वीज कंपन्या आणि TRAI कधीही SMS किंवा WhatsApp लिंकद्वारे OTP, KYC किंवा पैसे मागत नाहीत." },
    fir: { title: "रक्कम मोठी असल्यास FIR नोंदवा", detail: "cybercrime.gov.in चा तक्रार क्रमांक घेऊन जवळच्या पोलीस ठाण्यात किंवा सायबर सेलमध्ये जा. NyayaSathi तुमची तक्रार लिहून देऊ शकतो.", action: "NyayaSathi कडून लिहून घ्या" },
  },
};

const WHAT: Record<Lang, Record<string, string>> = {
  en: { card: "card", upi: "UPI", other: "account access", yourBank: "your bank" },
  hi: { card: "कार्ड", upi: "UPI", other: "खाते का एक्सेस", yourBank: "अपने बैंक" },
  mr: { card: "कार्ड", upi: "UPI", other: "खात्याचा ॲक्सेस", yourBank: "तुमच्या बँकेला" },
};

const HREF: Record<string, string> = {
  call1930: "tel:1930",
  call1930late: "tel:1930",
  portal: "https://cybercrime.gov.in",
  chakshu: "https://sancharsaathi.gov.in/sfc/",
  fir: "https://nyayasathi-xnmm.onrender.com",
};

function step(lang: Lang, key: string, id: string, urgent: boolean, vars: Record<string, string> = {}): Step {
  const x = T[lang][key];
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  return { id, title: fill(x.title), detail: fill(x.detail), urgent, action: x.action ? { label: x.action, href: HREF[key] } : undefined };
}

export function recoveryPlan(f: Facts, lang: Lang = "en"): Step[] {
  const steps: Step[] = [];
  if (f.lostMoney) {
    steps.push(step(lang, f.hoursAgo == null || f.hoursAgo <= 24 ? "call1930" : "call1930late", "call1930", true));
    steps.push(step(lang, "portal", "portal", true));
    const what = WHAT[lang][f.paidVia === "card" ? "card" : f.paidVia === "upi" ? "upi" : "other"];
    steps.push(step(lang, "bank", "bank", true, { what, bank: f.bank || WHAT[lang].yourBank }));
  }
  if (f.installedApp) steps.push(step(lang, "app", "app", true));
  if (f.sharedOtpOrPin) steps.push(step(lang, "secrets", "secrets", !f.lostMoney));
  steps.push(step(lang, "chakshu", "chakshu", false));
  steps.push(f.lostMoney ? step(lang, "fir", "fir", false) : step(lang, "ignore", "ignore", false));
  return steps;
}

const today = () => new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** Written intimation to the bank, in English as banks require: filled by code, with [placeholders]. */
export function bankLetter(f: Facts): string {
  const amount = f.amount ? `Rs. ${f.amount.toLocaleString("en-IN")}` : "Rs. [amount]";
  return [
    `To,`,
    `The Branch Manager / Customer Care,`,
    `${f.bank || "[Bank name]"}`,
    ``,
    `Date: ${today()}`,
    ``,
    `Subject: Intimation of unauthorised ${f.paidVia === "card" ? "card" : f.paidVia === "upi" ? "UPI" : "electronic banking"} transaction(s) due to fraud and request to block and reverse`,
    ``,
    `Sir/Madam,`,
    ``,
    `I, [Your full name], holder of account no. [account number], report that ${amount} was debited from my account through fraudulent transaction(s) on [date and time] (transaction/UTR no. [UTR]). The transaction(s) resulted from a fraud by a third party and were not authorised by me.`,
    ``,
    `I request you to (1) immediately block my ${f.paidVia === "card" ? "card" : "UPI and online banking access"}, (2) raise a fraud dispute and request the beneficiary bank to freeze the credited amount, and (3) credit the amount back to my account as per RBI circular DBR.No.Leg.BC.78/09.07.005/2017-18 dated 6 July 2017 on limiting customer liability in unauthorised electronic banking transactions. I have reported the fraud on the National Cyber Crime Reporting Portal (acknowledgement no. [acknowledgement number]).`,
    ``,
    `Please acknowledge this intimation with the date and time of receipt.`,
    ``,
    `Yours faithfully,`,
    `[Your full name]`,
    `[Mobile number registered with the bank]`,
  ].join("\n");
}
