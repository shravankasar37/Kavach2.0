// Recovery plan after a scam: decided by code from the facts, never by the model.
// Sources: National Cyber Crime Reporting Portal / 1930 (MHA I4C), Sanchar Saathi Chakshu (DoT),
// RBI circular "Customer Protection - Limiting Liability of Customers in Unauthorised Electronic Banking
// Transactions" (6 July 2017): zero liability if a third-party fraud is reported within 3 working days.

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

export function recoveryPlan(f: Facts): Step[] {
  const steps: Step[] = [];
  if (f.lostMoney) {
    const golden = f.hoursAgo == null || f.hoursAgo <= 24;
    steps.push({
      id: "call1930",
      title: "Call 1930 now",
      detail: golden
        ? "1930 is the national cyber-fraud helpline. Reporting quickly lets the police ask the receiving bank to freeze the money before it moves on. Have your bank name, the transaction ID (UTR) and the amount ready."
        : "Call 1930 even though some time has passed: the money can still be traced and frozen in later hops. Have your bank name, transaction ID (UTR) and amount ready.",
      urgent: true,
      action: { label: "Call 1930", href: "tel:1930" },
    });
    steps.push({
      id: "portal",
      title: "File a complaint on cybercrime.gov.in",
      detail: "Choose 'Report Financial Fraud'. Paste the incident description drafted below and attach screenshots of the message and the debit SMS. Note the acknowledgement number.",
      urgent: true,
      action: { label: "Open cybercrime.gov.in", href: "https://cybercrime.gov.in" },
    });
    steps.push({
      id: "bank",
      title: `Block your ${f.paidVia === "card" ? "card" : f.paidVia === "upi" ? "UPI" : "account access"} and tell ${f.bank || "your bank"}`,
      detail:
        "Call the number on the back of your card or in your bank's official app (never a number from the scam message). Ask them to block it and to raise a fraud dispute, and send the written intimation below. Under RBI's 2017 rules your liability is zero if a fraud you didn't cause is reported within 3 working days.",
      urgent: true,
    });
  }
  if (f.installedApp) {
    steps.push({
      id: "app",
      title: "Remove the app the scammer asked you to install",
      detail: "Turn off mobile data and Wi-Fi, uninstall any screen-sharing app (AnyDesk, TeamViewer, QuickSupport) or unknown APK, and change your banking passwords from a different device. If you can't remove it, back up photos and factory-reset the phone.",
      urgent: true,
    });
  }
  if (f.sharedOtpOrPin) {
    steps.push({
      id: "secrets",
      title: "Change your UPI PIN, net-banking password and card PIN",
      detail: "Do it from your bank's official app. An OTP or PIN you shared can be used again until it is changed.",
      urgent: !f.lostMoney,
    });
  }
  steps.push({
    id: "chakshu",
    title: "Report the number or message on Sanchar Saathi (Chakshu)",
    detail: "The Department of Telecom uses these reports to block fraudsters' numbers and handsets.",
    action: { label: "Open Sanchar Saathi", href: "https://sancharsaathi.gov.in/sfc/" },
  });
  if (!f.lostMoney) {
    steps.push({ id: "ignore", title: "Don't reply, click or call back", detail: "Block the sender and delete the message. Genuine banks, India Post, power companies and TRAI never ask for OTPs, KYC updates or payments through links in SMS or WhatsApp." });
  } else {
    steps.push({
      id: "fir",
      title: "Register an FIR if the amount is large",
      detail: "Take the cybercrime.gov.in acknowledgement to your nearest police station or cyber cell. NyayaSathi can draft the complaint for you.",
      action: { label: "Draft with NyayaSathi", href: "https://nyayasathi-xnmm.onrender.com" },
    });
  }
  return steps;
}

const today = () => new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** Written intimation to the bank: filled by code, with [placeholders] for what the user must add. */
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
