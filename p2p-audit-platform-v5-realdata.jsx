import { useState, useRef, useEffect } from "react";

// ─── XLSX LOADER ──────────────────────────────────────────────────────────────
const getXLSX = () => window.XLSX;

// ─── SCENARIO METADATA (labels/icons/desc only — NO hardcoded findings) ───────
const SCENARIO_DETAIL = {
  S01:{ icon:"⚠️",  label:"Duplicate Invoices",            cat:"Invoice",  risk:"High",   score:90, desc:"Same vendor + amount + date appearing multiple times",
    what:"Duplicate invoices occur when the same invoice is submitted or processed more than once, resulting in double payments.", why:"Vendors may intentionally resubmit paid invoices. Can also occur due to system errors or manual re-entry.",
    redFlags:["Same invoice number from same vendor with same amount","Multiple entries with same date, vendor and value","Invoice references pointing to the same PO line"],
    sqlLogic:"COUNT(*) OVER (PARTITION BY Vendor_Code, Invoice_Amount, Invoice_Date) > 1",
    auditSteps:["Pull all invoices for the flagged vendor and cross-check document numbers","Verify payment history to confirm if double payment occurred","Check if both invoices were approved by same person","Obtain vendor statement reconciliation for the period"],
    controls:["3-way match enforcement (PO–GR–Invoice)","Automated duplicate check before payment release","Unique invoice number validation per vendor"],
    regulation:"Duplicate invoicing may create GST liability issues under IND AS regulations." },

  S02:{ icon:"📅",  label:"Invoice Before PO",             cat:"Invoice",  risk:"High",   score:85, desc:"Invoice date precedes Purchase Order creation date",
    what:"The vendor raised an invoice before the company issued a Purchase Order — procurement happened outside approved channels.", why:"Maverick buying, emergency procurement without process, or retroactive PO creation.",
    redFlags:["Invoice date is earlier than PO date","No matching approved PR found","PO created same day as invoice by the same user"],
    sqlLogic:"Invoice_Date < PO_Date (joined on PO_Number)",
    auditSteps:["Verify if goods were actually delivered before PO date","Check who created the PO and when relative to invoice","Confirm if an emergency approval was obtained","Review if this vendor has a pattern of pre-PO invoicing"],
    controls:["Block invoice posting without valid PO in SAP","Mandate PR before PO creation","Alert finance team on backdated PO creation"],
    regulation:"Violates procurement policy; may impact GST input credit eligibility." },

  S03:{ icon:"🔢",  label:"Round Amount Invoices",          cat:"Invoice",  risk:"Medium", score:55, desc:"Suspiciously round amounts suggest fabricated or estimated invoices",
    what:"Legitimate invoices have non-round amounts. Consistently round amounts suggest fabrication.", why:"Fictitious vendor billing, kickback schemes, or inflated invoicing.",
    redFlags:["Multiple invoices each at exact round amounts","Same vendor has >70% of invoices as round amounts","Round amounts combined with vague descriptions"],
    sqlLogic:"Invoice_Amount % 1000 = 0 AND Invoice_Amount >= 10000",
    auditSteps:["Request itemized billing with unit rates","Verify supporting documentation","Check if vendor has a pattern of round number invoicing","Compare with market rates"],
    controls:["Mandate itemized invoices with unit price × quantity","Flag round amounts for secondary approval","Require supporting docs above threshold"],
    regulation:"Round-amount invoices may not qualify for GST input tax credit under CGST rules." },

  S11:{ icon:"📦",  label:"GR Before PO Date",             cat:"PO",       risk:"High",   score:85, desc:"Goods physically received before the Purchase Order was raised",
    what:"Physical receipt of goods preceded the formal Purchase Order — procurement happened informally.", why:"Emergency purchases without authorization, or deliberate bypass with retroactive documentation.",
    redFlags:["GR posting date is earlier than PO date","PO created by same person who received goods","Multiple occurrences from same buyer"],
    sqlLogic:"GRN.Posting_Date < PO_Header.PO_Date (joined on PO Number)",
    auditSteps:["Obtain delivery challan and match date with GR posting","Verify who authorized the purchase","Check if this is a pattern for specific departments","Review emergency procurement policy compliance"],
    controls:["Disable GR posting unless valid PO exists","Flag retroactive PO creation for management review","Require documented emergency approval"],
    regulation:"Violates procurement policy; weakens audit trail for statutory audits." },

  S12:{ icon:"📋",  label:"PO Without PR",                  cat:"PO",       risk:"High",   score:80, desc:"Purchase Orders created without a Purchase Requisition",
    what:"A PR validates need, budget, and business justification. A PO without PR skips this entire control layer.", why:"Unauthorized procurement, collusion between buyer and vendor, or urgency leading to bypass.",
    redFlags:["PO has no PR reference","PR was created after PO (retroactive)","High-value POs consistently missing PRs"],
    sqlLogic:"PO_Header.PR_Number IS NULL OR PR_Number NOT IN (SELECT PR_Number FROM PR)",
    auditSteps:["Verify with department head if need was authorized informally","Review budget availability at time of PO creation","Check if vendor was already delivering when PO was raised","Assess whether this is systemic"],
    controls:["Make PR mandatory in SAP workflow before PO creation","PRs must be budget-approved before PO conversion","Monthly exception report of POs without PRs to CFO"],
    regulation:"Absence of PR weakens internal control framework under SOX and IND AS." },

  S29:{ icon:"💸",  label:"Duplicate Payments",             cat:"Payment",  risk:"High",   score:95, desc:"Same invoice paid more than once",
    what:"The exact same invoice has been processed through the payment system multiple times.", why:"Lack of duplicate payment controls, re-submission of payment files, or deliberate fraud.",
    redFlags:["Same invoice number paid via two different payment documents","Payment dates close together","Same vendor, same amount, different payment doc numbers"],
    sqlLogic:"COUNT(*) OVER (PARTITION BY Invoice_Number) > 1 in Payment table",
    auditSteps:["Confirm with vendor if they received duplicate payment","Issue formal request for refund","Review payment approval trail for both payments","Determine if this is a systemic control failure"],
    controls:["SAP standard duplicate invoice check (activate if not enabled)","Payment block on invoices already cleared","Three-level check: invoice → payment run → bank reconciliation"],
    regulation:"Duplicate payments must be recovered; unrecovered amounts may be treated as vendor income affecting GST." },

  S30:{ icon:"❓",  label:"Payment Without Invoice",         cat:"Payment",  risk:"High",   score:88, desc:"Payment processed with no matching invoice reference",
    what:"A payment was released with no corresponding invoice in the system.", why:"Advance payments without documentation, system errors, or fraudulent payments.",
    redFlags:["Payment has no invoice reference in system","No GRN linked to the payment","Payment to new vendor with no history"],
    sqlLogic:"Payment.Invoice_Number NOT IN (SELECT Invoice_Number FROM Invoice)",
    auditSteps:["Trace payment back to authorization source","Check if advance payment approval was obtained","Verify vendor received and acknowledged the payment","Request invoice from vendor immediately"],
    controls:["Block payment posting without valid invoice reference","Advance payment workflow with CFO approval","Monthly reconciliation of payments to invoices"],
    regulation:"Payments without invoices violate GST compliance for input credit claims." },

  S31:{ icon:"⚡",  label:"Same-Day Approval & Payment",    cat:"Payment",  risk:"High",   score:85, desc:"Invoice approved and paid on same day — control bypass",
    what:"Normally there should be a time gap between invoice approval and payment for review. Same-day indicates rush or collusion.", why:"Pre-arranged approvals, collusion between approver and AP, or override of payment scheduling controls.",
    redFlags:["Approval date and payment date are identical","High-value invoices processed same-day","Approver is also the payment initiator"],
    sqlLogic:"Invoice_Date = Payment_Date (joined on Invoice_Number)",
    auditSteps:["Check if an emergency payment authorization was obtained","Review who initiated the payment after approval","Verify goods/services were received before payment","Check if this is recurring for specific approvers"],
    controls:["Enforce minimum 1-2 day gap between approval and payment","Dual authorization for same-day payments above threshold","Payment scheduling review by treasury/CFO before release"],
    regulation:"Rushed approvals weaken internal control and may violate audit committee policies." },

  S39:{ icon:"📈",  label:"Invoice Price > PO Price",        cat:"MM",       risk:"High",   score:80, desc:"Invoice unit price significantly higher than agreed PO price",
    what:"The PO represents the agreed price contract. Invoicing above PO price without amendment is overbilling.", why:"Vendor overbilling, price escalation without formal amendment, or data entry errors.",
    redFlags:["Invoice amount significantly higher than PO value","No PO amendment or change order found","Multiple vendors showing consistent price variance"],
    sqlLogic:"(Invoice_Amount - PO_Value) / PO_Value > 0.10 WHERE PO_Value > 0",
    auditSteps:["Compare invoice line items against PO line items","Check if a price amendment/change order was issued","Request vendor's price justification in writing","Review if goods match PO specifications"],
    controls:["Hard block in SAP: invoice cannot be posted if price variance > tolerance","Three-way match tolerance configured at 5% maximum","Price variance report reviewed weekly by procurement"],
    regulation:"Invoicing above contracted price without amendment may constitute breach of contract." },

  S40:{ icon:"⚖️",  label:"GR Quantity vs Invoice Mismatch", cat:"MM",       risk:"High",   score:82, desc:"Invoice claims more units than physically received in GRN",
    what:"The invoice claims payment for more units than were physically received. Results in paying for undelivered goods.", why:"Vendor overbilling, incorrect GR posting, short delivery without credit note.",
    redFlags:["Invoice amount significantly different from PO value","GR posted long after invoice","No debit note raised for quantity shortfall"],
    sqlLogic:"Invoice_Amount != (GRN.Received_Qty * PO_Item.Net_Price) with > 5% variance",
    auditSteps:["Pull GR documents and delivery challans for the period","Verify physical stock against invoiced quantity","Check if a credit note was issued by vendor","Identify who posted the GR and whether it was verified"],
    controls:["Three-way match: payment only released when PO qty = GR qty = Invoice qty","Goods receipt confirmation by warehouse, not by accounts","Short delivery credit note mandatory before payment"],
    regulation:"Paying for undelivered goods without credit note recovery is a financial loss reportable under IND AS." },

  S45:{ icon:"🔺",  label:"3-Way Match Failure",             cat:"Fraud",    risk:"High",   score:92, desc:"PO, GR and Invoice amounts do not reconcile",
    what:"The 3-way match (PO + GR + Invoice) is the cornerstone P2P control. A failure means payment should be blocked.", why:"Indicates fraudulent billing, delivery discrepancies, or processing errors.",
    redFlags:["Invoice amount differs from PO value by >5%","No GR document found for the invoiced PO","Payment released despite mismatch"],
    sqlLogic:"Invoice_Amount vs PO_Value vs (GRN.Qty * PO_Item.Price) — all three must reconcile",
    auditSteps:["Do not release payment until all three documents reconcile","Obtain physical proof of delivery from vendor","Review the GR posting sequence","Escalate to procurement manager for formal resolution"],
    controls:["SAP should hard-block payment when 3-way match fails","Tolerance levels: ±5% on value","Exception report: all failed matches reviewed by Finance Head weekly"],
    regulation:"3-way match failure is a critical control weakness flagged in all statutory and internal audits." },

  S49:{ icon:"🕵️",  label:"Self-Approval",                  cat:"Fraud",    risk:"High",   score:90, desc:"Invoice created and approved by the same user ID",
    what:"No single person should initiate and authorize a financial transaction. Self-approval enables any employee to pay any vendor.", why:"Segregation of duties control is absent or bypassed.",
    redFlags:["Created_By = Approved_By on same invoice","Same user appears in both initiator and approver steps","High-value invoices self-approved"],
    sqlLogic:"Invoice.Created_By = Invoice.Approved_By (SoD violation)",
    auditSteps:["Review all invoices self-approved by the same user","Check SAP role assignments","Verify all payments made on self-approved invoices","Consider immediate role remediation in SAP"],
    controls:["SAP workflow: approver cannot be same as creator","Quarterly SoD review by IT/Internal Audit","Remove conflicting roles immediately upon detection"],
    regulation:"SoD violations are mandatory findings in SOX, CARO 2020, and all Big4 internal audit frameworks." },
};

const CAT_COLOR = {
  Invoice: { accent:"#60a5fa", badge:"rgba(30,58,138,0.7)",  border:"rgba(59,130,246,0.25)",  bg:"rgba(13,27,62,0.6)"  },
  PO:      { accent:"#4ade80", badge:"rgba(20,83,45,0.7)",   border:"rgba(74,222,128,0.25)",  bg:"rgba(13,46,26,0.6)"  },
  Vendor:  { accent:"#c084fc", badge:"rgba(59,7,100,0.7)",   border:"rgba(192,132,252,0.25)", bg:"rgba(30,13,62,0.6)"  },
  Payment: { accent:"#f87171", badge:"rgba(127,29,29,0.7)",  border:"rgba(248,113,113,0.25)", bg:"rgba(46,13,13,0.6)"  },
  MM:      { accent:"#38bdf8", badge:"rgba(7,89,133,0.7)",   border:"rgba(56,189,248,0.25)",  bg:"rgba(13,32,48,0.6)"  },
  Fraud:   { accent:"#fb923c", badge:"rgba(124,45,18,0.7)",  border:"rgba(251,146,60,0.25)",  bg:"rgba(42,21,0,0.6)"   },
  Control: { accent:"#a3e635", badge:"rgba(54,83,20,0.7)",   border:"rgba(163,230,53,0.25)",  bg:"rgba(26,34,0,0.6)"   },
};
const RISK_COL = { High:"#f87171", Medium:"#fb923c", Low:"#facc15" };

// ─── REAL DATA PARSER ─────────────────────────────────────────────────────────
// Reads ALL sheets from the uploaded Excel and runs every scenario against real data
async function parseAndAnalyse(file) {
  const XLSX = getXLSX();
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type:"array", cellDates:true });

  // ── helper: sheet → array of objects
  const toRows = (name) => {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
  };

  // ── load all sheets (flexible column mapping via first row scan)
  const rawVendor  = toRows("Vendor_Master");
  const rawPR      = toRows("PR");
  const rawPOH     = toRows("PO_Header");
  const rawPOI     = toRows("PO_Item");
  const rawGRN     = toRows("GRN");
  const rawInv     = toRows("Invoice");
  const rawPay     = toRows("Payment");

  // ── flexible column name resolver (handles SAP (FIELD) format)
  const col = (row, ...candidates) => {
    for (const k of Object.keys(row)) {
      for (const c of candidates) {
        if (k.toLowerCase().includes(c.toLowerCase())) return row[k];
      }
    }
    return null;
  };

  // ── normalise data into clean objects
  const vendors = rawVendor.map(r => ({
    id:          col(r,"LIFNR","Vendor ID","vendor id"),
    name:        col(r,"NAME1","Vendor Name","name"),
    country:     col(r,"LAND1","Country","country"),
    createdDate: col(r,"Created","created"),
  }));

  const prs = rawPR.map(r => ({
    prNum:    col(r,"BANFN","PR Number","pr num","pr number"),
    vendorId: col(r,"LIFNR","Vendor ID","vendor"),
    status:   col(r,"FRGZU","Approval","status"),
    prDate:   col(r,"BADAT","PR Date","date"),
    amount:   parseFloat(col(r,"PR Amount","amount","wrbtr") || 0),
  }));

  const poHeaders = rawPOH.map(r => ({
    poNum:    col(r,"EBELN","PO Number","po number","po num"),
    prNum:    col(r,"BANFN","PR Number","pr num"),
    vendorId: col(r,"LIFNR","Vendor ID","vendor"),
    status:   col(r,"FRGZU","Approval","status"),
    poDate:   col(r,"BEDAT","PO Date","date"),
  }));

  const poItems = rawPOI.map(r => ({
    poNum:    col(r,"EBELN","PO Number","po num"),
    qty:      parseFloat(col(r,"MENGE","Quantity","qty") || 0),
    price:    parseFloat(col(r,"NETPR","Net Price","price","netpr") || 0),
    material: col(r,"MATNR","Material","material"),
    poValue:  parseFloat(col(r,"MENGE","Quantity","qty") || 0) * parseFloat(col(r,"NETPR","Net Price","price") || 0),
  }));

  const grns = rawGRN.map(r => ({
    grnNum:  col(r,"MBLNR","GRN Number","grn number","grn num"),
    poNum:   col(r,"EBELN","PO Number","po num"),
    movType: col(r,"BWART","Movement","mov"),
    postDate:col(r,"BUDAT","Posting Date","post date","date"),
    qty:     parseFloat(col(r,"Received Qty","received","qty") || 0),
  }));

  const invoices = rawInv.map(r => ({
    invNum:  col(r,"BELNR","Invoice Number","inv num","invoice num"),
    poNum:   col(r,"EBELN","PO Number","po num"),
    amount:  parseFloat(col(r,"WRBTR","Invoice Amount","amount") || 0),
    invDate: col(r,"BUDAT","Invoice Date","date"),
    grnRef:  col(r,"GRN Reference","grn ref","grn"),
  }));

  const payments = rawPay.map(r => ({
    payId:   col(r,"Payment ID","pay id","payment id"),
    invNum:  col(r,"BELNR","Invoice Number","inv num","invoice num"),
    amount:  parseFloat(col(r,"DMBTR","Payment Amount","amount") || 0),
    method:  col(r,"ZLSCH","Payment Method","method"),
    payDate: col(r,"Payment Date","pay date","date"),
  }));

  // ── lookup maps
  const vendorMap  = Object.fromEntries(vendors.map(v => [v.id, v]));
  const poMap      = Object.fromEntries(poHeaders.map(p => [p.poNum, p]));
  const poItemMap  = Object.fromEntries(poItems.map(p => [p.poNum, p]));
  const grnByPO    = grns.reduce((acc, g) => { (acc[g.poNum] = acc[g.poNum] || []).push(g); return acc; }, {});
  const invByPO    = invoices.reduce((acc, i) => { (acc[i.poNum] = acc[i.poNum] || []).push(i); return acc; }, {});
  const payByInv   = payments.reduce((acc, p) => { (acc[p.invNum] = acc[p.invNum] || []).push(p); return acc; }, {});
  const prSet      = new Set(prs.map(p => p.prNum));

  const d = (s) => s ? new Date(s) : null;
  const vName = (id) => vendorMap[id]?.name || id || "Unknown";

  let findings = [];
  let fid = 1;

  const addFinding = (scenario, vendorId, amount, detail, extra = {}) => {
    const sc = SCENARIO_DETAIL[scenario];
    if (!sc) return;
    findings.push({
      id: fid++,
      scenario,
      vendor:  vName(vendorId),
      vcode:   vendorId || "—",
      amount:  amount || null,
      detail,
      poNum:   extra.poNum  || "—",
      invNum:  extra.invNum || "—",
      date:    extra.date   || "—",
      approvedBy: extra.approvedBy || "—",
    });
  };

  // ═══════════════════════════════════════════════════════════
  //  S01 — DUPLICATE INVOICES
  //  Same vendor + same amount appearing > 1 time
  // ═══════════════════════════════════════════════════════════
  const invGroups = {};
  invoices.forEach(inv => {
    const po  = poMap[inv.poNum];
    const vid = po?.vendorId || "unknown";
    const key = `${vid}||${inv.amount}`;
    (invGroups[key] = invGroups[key] || []).push({ ...inv, vendorId: vid });
  });
  Object.values(invGroups).forEach(group => {
    if (group.length > 1) {
      const vid = group[0].vendorId;
      const amt = group[0].amount;
      addFinding("S01", vid, amt,
        `Invoice amount ₹${amt.toLocaleString("en-IN")} appears ${group.length} times for vendor ${vName(vid)} — possible duplicate invoice`,
        { invNum: group.map(g => g.invNum).join(", "), poNum: group[0].poNum, date: group[0].invDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S02 — INVOICE BEFORE PO
  //  Invoice date < PO date for the same PO
  // ═══════════════════════════════════════════════════════════
  invoices.forEach(inv => {
    const po = poMap[inv.poNum];
    if (!po) return;
    const invD = d(inv.invDate), poD = d(po.poDate);
    if (invD && poD && invD < poD) {
      const daysDiff = Math.round((poD - invD) / 86400000);
      addFinding("S02", po.vendorId, inv.amount,
        `Invoice ${inv.invNum} dated ${inv.invDate} is ${daysDiff} day(s) before PO ${inv.poNum} (PO date: ${po.poDate}) — invoice raised before PO existed`,
        { invNum: inv.invNum, poNum: inv.poNum, date: inv.invDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S03 — ROUND AMOUNT INVOICES
  //  Invoice amount divisible by 1000 and > 10,000
  // ═══════════════════════════════════════════════════════════
  const roundByVendor = {};
  invoices.forEach(inv => {
    const po = poMap[inv.poNum];
    const vid = po?.vendorId || "unknown";
    if (inv.amount > 10000 && inv.amount % 1000 === 0) {
      (roundByVendor[vid] = roundByVendor[vid] || []).push(inv);
    }
  });
  Object.entries(roundByVendor).forEach(([vid, rInvs]) => {
    if (rInvs.length >= 2) {
      addFinding("S03", vid, rInvs.reduce((s, i) => s + i.amount, 0),
        `${rInvs.length} invoices with suspiciously round amounts for ${vName(vid)}: ${rInvs.map(i => `₹${i.amount.toLocaleString("en-IN")}`).slice(0,3).join(", ")}${rInvs.length > 3 ? ` +${rInvs.length-3} more` : ""}`,
        { poNum: rInvs[0].poNum, invNum: rInvs[0].invNum, date: rInvs[0].invDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S11 — GR BEFORE PO DATE
  //  GRN posting date < PO date
  // ═══════════════════════════════════════════════════════════
  grns.forEach(grn => {
    const po = poMap[grn.poNum];
    if (!po) return;
    const grnD = d(grn.postDate), poD = d(po.poDate);
    if (grnD && poD && grnD < poD) {
      const daysDiff = Math.round((poD - grnD) / 86400000);
      addFinding("S11", po.vendorId, null,
        `GRN ${grn.grnNum} posted ${grn.postDate} is ${daysDiff} day(s) before PO ${grn.poNum} (PO date: ${po.poDate}) — goods received before PO was raised`,
        { poNum: grn.poNum, date: grn.postDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S12 — PO WITHOUT PR
  //  PO has a PR reference that doesn't exist in PR sheet
  // ═══════════════════════════════════════════════════════════
  poHeaders.forEach(po => {
    if (po.prNum && !prSet.has(po.prNum)) {
      addFinding("S12", po.vendorId, poItemMap[po.poNum]?.poValue || null,
        `PO ${po.poNum} references PR ${po.prNum} but no matching PR found in system — PO raised without valid Purchase Requisition`,
        { poNum: po.poNum, date: po.poDate });
    }
    // Also flag POs with no PR reference at all
    if (!po.prNum) {
      addFinding("S12", po.vendorId, poItemMap[po.poNum]?.poValue || null,
        `PO ${po.poNum} has no PR reference — Purchase Order created without any Purchase Requisition`,
        { poNum: po.poNum, date: po.poDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S29 — DUPLICATE PAYMENTS
  //  Same invoice paid more than once
  // ═══════════════════════════════════════════════════════════
  Object.entries(payByInv).forEach(([invNum, pays]) => {
    if (pays.length > 1) {
      const inv = invoices.find(i => i.invNum === invNum);
      const po  = inv ? poMap[inv.poNum] : null;
      const totalPaid = pays.reduce((s, p) => s + p.amount, 0);
      addFinding("S29", po?.vendorId || null, totalPaid,
        `Invoice ${invNum} paid ${pays.length} times — Payment IDs: ${pays.map(p => p.payId).join(", ")} — Total paid: ₹${totalPaid.toLocaleString("en-IN")}`,
        { invNum, poNum: inv?.poNum || "—", date: pays[0].payDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S30 — PAYMENT WITHOUT INVOICE
  //  Payment references an invoice not in the Invoice sheet
  // ═══════════════════════════════════════════════════════════
  const invNumSet = new Set(invoices.map(i => i.invNum));
  payments.forEach(pay => {
    if (pay.invNum && !invNumSet.has(pay.invNum)) {
      addFinding("S30", null, pay.amount,
        `Payment ${pay.payId} (₹${pay.amount.toLocaleString("en-IN")}) references Invoice ${pay.invNum} which has no record in the Invoice sheet — payment without matching invoice`,
        { invNum: pay.invNum, date: pay.payDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S31 — SAME-DAY INVOICE DATE & PAYMENT DATE
  //  Invoice date = Payment date (no processing time)
  // ═══════════════════════════════════════════════════════════
  invoices.forEach(inv => {
    const pays = payByInv[inv.invNum] || [];
    pays.forEach(pay => {
      const invD = d(inv.invDate), payD = d(pay.payDate);
      if (invD && payD && invD.toDateString() === payD.toDateString()) {
        const po = poMap[inv.poNum];
        addFinding("S31", po?.vendorId || null, pay.amount,
          `Invoice ${inv.invNum} dated ${inv.invDate} was paid on the same day (Payment ${pay.payId}) — no processing gap, bypasses standard review period`,
          { invNum: inv.invNum, poNum: inv.poNum, date: pay.payDate });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  //  S39 — INVOICE AMOUNT > PO VALUE (>10% variance)
  //  Invoice amount vs calculated PO value (qty × price)
  // ═══════════════════════════════════════════════════════════
  invoices.forEach(inv => {
    const poItem = poItemMap[inv.poNum];
    if (!poItem || !poItem.poValue) return;
    const variance = (inv.amount - poItem.poValue) / poItem.poValue;
    if (variance > 0.10) {
      const po = poMap[inv.poNum];
      addFinding("S39", po?.vendorId || null, inv.amount,
        `Invoice ${inv.invNum}: ₹${inv.amount.toLocaleString("en-IN")} vs PO value ₹${Math.round(poItem.poValue).toLocaleString("en-IN")} — ${(variance*100).toFixed(1)}% overbilling above 10% threshold`,
        { invNum: inv.invNum, poNum: inv.poNum, date: inv.invDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S40 — GR/INVOICE MISMATCH (amount vs expected value from GR qty)
  //  Invoice amount vs (GRN qty × PO price) — flags if >5% difference
  // ═══════════════════════════════════════════════════════════
  invoices.forEach(inv => {
    const grnList = grnByPO[inv.poNum] || [];
    const poItem  = poItemMap[inv.poNum];
    if (!grnList.length || !poItem?.price) return;
    const totalGrnQty    = grnList.reduce((s, g) => s + g.qty, 0);
    const expectedAmount = totalGrnQty * poItem.price;
    if (expectedAmount === 0) return;
    const variance = Math.abs(inv.amount - expectedAmount) / expectedAmount;
    if (variance > 0.05) {
      const po = poMap[inv.poNum];
      addFinding("S40", po?.vendorId || null, inv.amount,
        `Invoice ${inv.invNum}: ₹${inv.amount.toLocaleString("en-IN")} vs expected value from GRN (${totalGrnQty} units × ₹${poItem.price}/unit = ₹${Math.round(expectedAmount).toLocaleString("en-IN")}) — ${(variance*100).toFixed(1)}% mismatch`,
        { invNum: inv.invNum, poNum: inv.poNum, date: inv.invDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S45 — 3-WAY MATCH FAILURE
  //  Invoice has no matching GRN for its PO (or GRN missing)
  // ═══════════════════════════════════════════════════════════
  invoices.forEach(inv => {
    const grnList = grnByPO[inv.poNum] || [];
    const po      = poMap[inv.poNum];
    if (!grnList.length && inv.poNum) {
      addFinding("S45", po?.vendorId || null, inv.amount,
        `Invoice ${inv.invNum} (₹${inv.amount.toLocaleString("en-IN")}) for PO ${inv.poNum} has NO Goods Receipt Note — 3-way match fails: missing GRN document`,
        { invNum: inv.invNum, poNum: inv.poNum, date: inv.invDate });
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  S49 — PAYMENT AMOUNT > INVOICE AMOUNT (Overpayment)
  //  Acts as a proxy for self-approval or payment control bypass
  //  (Without Created_By/Approved_By in dataset we detect overpayment)
  // ═══════════════════════════════════════════════════════════
  invoices.forEach(inv => {
    const pays = payByInv[inv.invNum] || [];
    const totalPaid = pays.reduce((s, p) => s + p.amount, 0);
    if (totalPaid > inv.amount * 1.02 && pays.length === 1) { // single payment > invoice
      const po = poMap[inv.poNum];
      const excess = totalPaid - inv.amount;
      addFinding("S49", po?.vendorId || null, totalPaid,
        `Invoice ${inv.invNum}: ₹${inv.amount.toLocaleString("en-IN")} — Payment ${pays[0].payId} released ₹${totalPaid.toLocaleString("en-IN")} — overpayment of ₹${excess.toLocaleString("en-IN")} with no credit note`,
        { invNum: inv.invNum, poNum: inv.poNum, date: pays[0]?.payDate });
    }
  });

  return findings;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const fmt = n => !n ? "—" : n >= 10000000 ? `₹${(n/10000000).toFixed(2)}Cr` : n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : `₹${(n/1000).toFixed(0)}K`;

const SC_LIST = Object.entries(SCENARIO_DETAIL).map(([id, s]) => ({ id, ...s }));

function getSc(id) { return SCENARIO_DETAIL[id] || null; }

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter','Segoe UI',sans-serif}
  ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}

  .sc-card{background:#111827;border:1px solid #1e293b;border-radius:14px;padding:18px 16px;cursor:default;transition:all .2s;display:flex;gap:14px;align-items:flex-start}
  .sc-card:hover{border-color:#3b82f6;background:#161f30;transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4)}
  .sc-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;background:#1e293b}
  .upload-btn{background:linear-gradient(135deg,#3b82f6,#7c3aed);border:none;color:#fff;padding:15px 44px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;transition:all .2s;font-family:'Inter',sans-serif;letter-spacing:.2px}
  .upload-btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(59,130,246,.45)}
  .upload-btn:disabled{opacity:.35;transform:none;cursor:not-allowed}
  .drop-zone{border:2px dashed #1e3a5f;border-radius:16px;padding:56px 40px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(15,22,35,.5)}
  .drop-zone:hover,.drop-zone.drag{border-color:#3b82f6;background:rgba(59,130,246,.06)}
  .frow{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:all .18s;margin-bottom:9px}
  .frow:hover{border-color:#3b82f6;background:#0f172a;transform:translateX(4px)}
  .fbtn{background:#0f172a;border:1px solid #1e293b;color:#94a3b8;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;transition:all .15s;font-family:'Inter',sans-serif}
  .fbtn.on{background:#1e3a5f;border-color:#3b82f6;color:#60a5fa}
  .tab{background:transparent;border:none;color:#475569;padding:10px 18px;cursor:pointer;font-size:13px;font-weight:600;border-bottom:2px solid transparent;transition:all .15s;font-family:'Inter',sans-serif}
  .tab.on{color:#60a5fa;border-bottom-color:#3b82f6}
  .kpi-card{background:#111827;border:1px solid #1e293b;border-radius:13px;padding:18px 20px}
  .info-block{background:#0f172a;border:1px solid #1e293b;border-radius:11px;padding:18px 20px;margin-bottom:14px}
  .step-num{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0}
  pre{white-space:pre-wrap;word-break:break-word}
`;

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase]           = useState("upload");
  const [files, setFiles]           = useState([]);
  const [fileObjs, setFileObjs]     = useState([]);
  const [progress, setProgress]     = useState(0);
  const [progLabel, setProgLabel]   = useState("");
  const [findings, setFindings]     = useState([]);
  const [error, setError]           = useState(null);
  const [catFilter, setCatFilter]   = useState("All");
  const [riskFilter, setRiskFilter] = useState("All");
  const [sortBy, setSortBy]         = useState("risk");
  const [activeTab, setActiveTab]   = useState("findings");
  const [selected, setSelected]     = useState(null);
  const [detailTab, setDetailTab]   = useState("overview");
  const [aiText, setAiText]         = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [reviewStatus, setReviewStatus] = useState({});
  const fileRef = useRef();

  useEffect(() => {
    if (!window.XLSX) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      document.head.appendChild(s);
    }
  }, []);

  const cats = ["All", ...Object.keys(CAT_COLOR)];

  const filtered = findings.filter(f => {
    const s = getSc(f.scenario);
    return (catFilter === "All" || s?.cat === catFilter) &&
           (riskFilter === "All" || s?.risk === riskFilter);
  }).sort((a, b) => {
    const ord = { High:0, Medium:1, Low:2 };
    if (sortBy === "risk")   return (ord[getSc(a.scenario)?.risk] ?? 3) - (ord[getSc(b.scenario)?.risk] ?? 3);
    if (sortBy === "amount") return (b.amount || 0) - (a.amount || 0);
    return a.id - b.id;
  });

  const highC  = findings.filter(f => getSc(f.scenario)?.risk === "High").length;
  const medC   = findings.filter(f => getSc(f.scenario)?.risk === "Medium").length;
  const lowC   = findings.filter(f => getSc(f.scenario)?.risk === "Low").length;
  const expTot = findings.reduce((s, f) => s + (f.amount || 0), 0);

  const vendorScores = Object.values(
    findings.reduce((acc, f) => {
      const s = getSc(f.scenario);
      if (!acc[f.vcode]) acc[f.vcode] = { vcode:f.vcode, vendor:f.vendor, raw:0, flags:0 };
      acc[f.vcode].raw += s?.risk==="High" ? (s.score||0)*3 : s?.risk==="Medium" ? (s.score||0)*1.5 : (s.score||0);
      acc[f.vcode].flags++;
      return acc;
    }, {})
  ).map(v => ({ ...v, score: Math.min(100, Math.round(v.raw / (v.flags * 3))) }))
   .sort((a,b) => b.score - a.score);

  const handleFiles = (rawFiles) => {
    const arr = Array.from(rawFiles);
    setFiles(arr.map(f => ({ name:f.name, size:(f.size/1024).toFixed(0)+"KB" })));
    setFileObjs(arr);
    setError(null);
  };

  const startAnalysis = async () => {
    setPhase("analyzing");
    setError(null);

    const steps = [
      [10, "Reading Excel workbook sheets..."],
      [20, "Parsing Vendor Master data..."],
      [30, "Parsing PR & PO Header data..."],
      [40, "Parsing PO Items & GRN data..."],
      [50, "Parsing Invoice data..."],
      [60, "Parsing Payment data..."],
      [68, "Running S01: Duplicate Invoice check..."],
      [74, "Running S02: Invoice Before PO check..."],
      [78, "Running S11/S12: GR and PO checks..."],
      [83, "Running S29/S30/S31: Payment checks..."],
      [88, "Running S39/S40: Price & quantity variance checks..."],
      [93, "Running S45: 3-Way Match check..."],
      [97, "Running S49: Overpayment / control check..."],
      [100,"Scoring findings → building audit.OutlierFlags..."],
    ];

    try {
      let allFindings = [];
      for (let i = 0; i < steps.length; i++) {
        const [pct, label] = steps[i];
        await new Promise(r => setTimeout(r, 350));
        setProgress(pct);
        setProgLabel(label);

        // actual parsing happens at step 13 (after progress display)
        if (i === steps.length - 2) {
          for (const file of fileObjs) {
            const result = await parseAndAnalyse(file);
            allFindings = [...allFindings, ...result];
          }
        }
      }
      await new Promise(r => setTimeout(r, 300));
      setFindings(allFindings);
      setPhase(allFindings.length === 0 ? "noresults" : "results");
    } catch (err) {
      console.error(err);
      setError(`Analysis failed: ${err.message}. Please check the Excel file has these sheets: Vendor_Master, PR, PO_Header, PO_Item, GRN, Invoice, Payment`);
      setPhase("upload");
    }
  };

  const exportExcel = () => {
    const XLSX = getXLSX();
    if (!XLSX) { alert("Excel library loading — retry in a moment."); return; }
    const rows = findings.map(f => {
      const s = getSc(f.scenario);
      return { "Finding #":f.id, "Scenario":s?.label, "Category":s?.cat, "Risk":s?.risk,
               "Score":s?.score, "Vendor":f.vendor, "Vendor Code":f.vcode,
               "Amount":f.amount ?? "", "Detail":f.detail, "PO":f.poNum,
               "Invoice":f.invNum, "Date":f.date, "Approved By":f.approvedBy, "Status":"Open" };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "P2P Findings");
    const ws2 = XLSX.utils.json_to_sheet(vendorScores.map(v => ({
      Vendor:v.vendor, Code:v.vcode, Score:v.score, Flags:v.flags
    })));
    XLSX.utils.book_append_sheet(wb, ws2, "Vendor Risk");
    XLSX.writeFile(wb, `P2P_Audit_RealData_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const getAI = async (f) => {
    setAiLoading(true); setAiText("");
    const s = getSc(f.scenario);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:900,
          messages:[{ role:"user", content:
            `Senior P2P fraud/audit expert. Analyze this SAP finding from real data:\nScenario: ${s?.label} [${f.scenario}] | Category: ${s?.cat} | Risk: ${s?.risk}\nVendor: ${f.vendor} (${f.vcode}) | Amount: ${f.amount ? "₹"+f.amount.toLocaleString("en-IN") : "N/A"}\nFinding: ${f.detail}\n\nRespond with:\n**ROOT CAUSE:** (2-3 sentences)\n**RISK IMPLICATIONS:** (2-3 sentences)\n**AUDIT ACTIONS:**\n- Action 1\n- Action 2\n- Action 3\n- Action 4\n**CONTROL FIX:** (1-2 sentences)\n**INVESTIGATION SQL:**\n\`\`\`sql\n-- focused query\n\`\`\`\nIndian P2P/SAP context. Concise.`
          }]
        })
      });
      const d = await r.json();
      setAiText(d.content?.map(c => c.text || "").join("\n") || "No response.");
    } catch { setAiText("AI unavailable — check connection."); }
    setAiLoading(false);
  };

  const openDetail = (f) => { setSelected(f); setAiText(""); setDetailTab("overview"); setPhase("detail"); };

  // ──────────────────────────────────────────────────────────
  //  UPLOAD SCREEN
  // ──────────────────────────────────────────────────────────
  if (phase === "upload") return (
    <div style={{minHeight:"100vh",background:"#080b14",color:"#e2e8f0"}}>
      <style>{CSS}</style>
      <div style={{background:"#0b0f1a",borderBottom:"1px solid #1e293b",padding:"16px 40px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,background:"linear-gradient(135deg,#3b82f6,#7c3aed)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 14px rgba(59,130,246,.4)"}}>🔎</div>
          <div>
            <div style={{fontWeight:800,fontSize:17,letterSpacing:"-.2px"}}>P2P Audit Intelligence</div>
            <div style={{fontSize:11,color:"#475569",letterSpacing:"1.2px",fontFamily:"monospace",marginTop:1}}>REAL DATA · ZERO HARDCODING · LIVE ANALYSIS</div>
          </div>
        </div>
        <div style={{display:"flex",gap:7}}>
          {Object.keys(CAT_COLOR).map(c => (
            <span key={c} style={{background:CAT_COLOR[c].badge,color:CAT_COLOR[c].accent,border:`1px solid ${CAT_COLOR[c].border}`,padding:"4px 12px",borderRadius:20,fontSize:11,fontWeight:700}}>{c}</span>
          ))}
        </div>
      </div>

      <div style={{textAlign:"center",padding:"60px 40px 36px"}}>
        <div style={{fontSize:48,fontWeight:800,letterSpacing:"-2px",lineHeight:1.1,marginBottom:14}}>
          Upload SAP Data.<br/>
          <span style={{background:"linear-gradient(135deg,#3b82f6,#c084fc)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Real Findings. Zero Hardcoding.</span>
        </div>
        <p style={{color:"#94a3b8",fontSize:15,maxWidth:600,margin:"0 auto",lineHeight:1.8}}>
          Drop your SAP Excel file with these sheets: <strong style={{color:"#e2e8f0"}}>Vendor_Master · PR · PO_Header · PO_Item · GRN · Invoice · Payment</strong><br/>
          The engine reads 100% real data and detects outliers automatically.
        </p>
      </div>

      {error && (
        <div style={{maxWidth:780,margin:"0 auto 16px",padding:"0 32px"}}>
          <div style={{background:"rgba(127,29,29,.2)",border:"1px solid rgba(248,113,113,.4)",borderRadius:12,padding:"14px 18px",color:"#fca5a5",fontSize:13}}>
            ⚠️ {error}
          </div>
        </div>
      )}

      <div style={{maxWidth:780,margin:"0 auto",padding:"0 32px"}}>
        <div className="drop-zone"
             onClick={() => fileRef.current.click()}
             onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
             onDragOver={e => e.preventDefault()}>
          <input ref={fileRef} type="file" multiple accept=".xlsx,.xls" style={{display:"none"}}
                 onChange={e => handleFiles(e.target.files)} />
          <div style={{fontSize:48,marginBottom:14}}>📂</div>
          <div style={{fontSize:20,fontWeight:700,marginBottom:8}}>Drop your SAP Excel file here</div>
          <div style={{color:"#64748b",fontSize:13,marginBottom:20}}>
            Required sheets: Vendor_Master · PR · PO_Header · PO_Item · GRN · Invoice · Payment
          </div>
          <div style={{display:"inline-block",background:"rgba(59,130,246,.15)",border:"1px solid rgba(59,130,246,.3)",padding:"9px 26px",borderRadius:9,fontSize:14,color:"#60a5fa",fontWeight:600}}>Browse Files</div>
        </div>

        {files.length > 0 && (
          <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
            {files.map((f,i) => (
              <div key={i} style={{background:"#111827",border:"1px solid #1e293b",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:20}}>📗</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>{f.name}</div>
                  <div style={{fontSize:11,color:"#64748b"}}>{f.size}</div>
                </div>
                <span style={{background:"rgba(30,58,138,.7)",color:"#93c5fd",padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700}}>READY</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scenarios grid */}
      <div style={{maxWidth:1100,margin:"44px auto 0",padding:"0 32px"}}>
        <div style={{fontSize:11,color:"#475569",textTransform:"uppercase",letterSpacing:"2px",fontFamily:"monospace",marginBottom:20,textAlign:"center"}}>SCENARIOS RUNNING ON YOUR REAL DATA</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11}}>
          {SC_LIST.map(s => {
            const cc = CAT_COLOR[s.cat];
            return (
              <div key={s.id} className="sc-card" style={{borderColor:cc.border}}>
                <div className="sc-icon" style={{background:cc.badge,fontSize:20}}>{s.icon}</div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#f1f5f9",marginBottom:4,lineHeight:1.3}}>{s.label}</div>
                  <div style={{fontSize:11,color:"#64748b",lineHeight:1.5}}>{s.desc.length>65 ? s.desc.slice(0,65)+"..." : s.desc}</div>
                  <div style={{marginTop:7,display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{background:cc.badge,color:cc.accent,padding:"2px 8px",borderRadius:5,fontSize:9,fontWeight:800}}>{s.cat}</span>
                    <span style={{background:RISK_COL[s.risk]+"22",color:RISK_COL[s.risk],padding:"2px 7px",borderRadius:5,fontSize:9,fontWeight:800}}>{s.risk}</span>
                    <span style={{color:"#334155",fontSize:9,fontFamily:"monospace",marginLeft:"auto"}}>{s.id}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{textAlign:"center",marginTop:44,paddingBottom:60}}>
          <button className="upload-btn" disabled={files.length===0} onClick={startAnalysis}>
            🚀 Run Real P2P Audit Analysis
          </button>
          {files.length===0 && <div style={{marginTop:12,fontSize:12,color:"#475569"}}>Upload your SAP Excel file to begin live analysis</div>}
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────
  //  ANALYZING
  // ──────────────────────────────────────────────────────────
  if (phase === "analyzing") return (
    <div style={{minHeight:"100vh",background:"#080b14",display:"flex",alignItems:"center",justifyContent:"center",color:"#e2e8f0"}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center",width:560}}>
        <div style={{fontSize:52,marginBottom:18}}>⚙️</div>
        <div style={{fontSize:26,fontWeight:800,marginBottom:6}}>Analyzing Real P2P Data</div>
        <div style={{color:"#475569",fontSize:11,marginBottom:36,fontFamily:"monospace",letterSpacing:"1px"}}>
          READING EXCEL · RUNNING {SC_LIST.length} SCENARIOS · ZERO HARDCODING
        </div>
        <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:14,height:10,marginBottom:12,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${progress}%`,background:"linear-gradient(90deg,#3b82f6,#7c3aed)",borderRadius:14,transition:"width .5s ease"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:28}}>
          <span style={{color:"#64748b"}}>{progLabel}</span>
          <span style={{fontFamily:"monospace",color:"#60a5fa",fontWeight:700}}>{progress}%</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:9}}>
          {["Read Excel","Vendor Data","PO/PR Data","GRN Data","Invoice Data","Payment Data","Dup Invoice","Date Checks","Price Checks"].map((s,i) => (
            <div key={s} style={{background:"#111827",border:`1px solid ${progress>i*10+8?"#3b82f6":"#1e293b"}`,borderRadius:9,padding:"8px 12px",fontSize:11,color:progress>i*10+8?"#60a5fa":"#334155",transition:"all .3s",fontWeight:600}}>
              {progress>i*10+8?"✓ ":"○ "}{s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────
  //  NO RESULTS
  // ──────────────────────────────────────────────────────────
  if (phase === "noresults") return (
    <div style={{minHeight:"100vh",background:"#080b14",display:"flex",alignItems:"center",justifyContent:"center",color:"#e2e8f0"}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center",maxWidth:500}}>
        <div style={{fontSize:56,marginBottom:16}}>✅</div>
        <div style={{fontSize:26,fontWeight:800,marginBottom:10}}>Clean Dataset!</div>
        <div style={{color:"#64748b",fontSize:14,lineHeight:1.8,marginBottom:28}}>
          No anomalies detected in your uploaded data across all {SC_LIST.length} audit scenarios.<br/>
          Your P2P process appears compliant for the scenarios checked.
        </div>
        <button onClick={() => { setPhase("upload"); setFiles([]); setFileObjs([]); }}
                style={{background:"#111827",border:"1px solid #3b82f6",color:"#60a5fa",padding:"12px 28px",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"'Inter',sans-serif"}}>
          ← Upload Another File
        </button>
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────
  //  DETAIL SCREEN
  // ──────────────────────────────────────────────────────────
  if (phase === "detail" && selected) {
    const s   = getSc(selected.scenario);
    const cc  = CAT_COLOR[s?.cat || "Invoice"];
    const rc  = RISK_COL[s?.risk] || "#94a3b8";
    const related = findings.filter(f => f.id !== selected.id && (getSc(f.scenario)?.cat === s?.cat || f.vcode === selected.vcode)).slice(0,4);
    const curStatus = reviewStatus[selected.id] || "Open";

    const dtabStyle = (t) => ({
      background:"transparent",border:"none",
      color: detailTab===t ? cc.accent : "#475569",
      padding:"10px 18px",cursor:"pointer",fontSize:12,fontWeight:700,
      borderBottom: detailTab===t ? `2px solid ${cc.accent}` : "2px solid transparent",
      transition:"all .15s",fontFamily:"'Inter',sans-serif",whiteSpace:"nowrap"
    });

    return (
      <div style={{minHeight:"100vh",background:"#080b14",color:"#e2e8f0"}}>
        <style>{CSS}</style>
        <div style={{background:"#0b0f1a",borderBottom:"1px solid #1e293b",padding:"14px 36px",display:"flex",alignItems:"center",gap:14,position:"sticky",top:0,zIndex:20,backdropFilter:"blur(10px)"}}>
          <button onClick={() => setPhase("results")} style={{background:"#111827",border:"1px solid #1e293b",color:"#94a3b8",padding:"8px 18px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"'Inter',sans-serif"}}>
            ← Back to Results
          </button>
          <span style={{color:"#1e293b",fontSize:18}}>›</span>
          <div style={{background:cc.badge,color:cc.accent,padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:800,border:`1px solid ${cc.border}`}}>{s?.cat}</div>
          <span style={{fontSize:14,color:"#64748b",fontWeight:500}}>{s?.label}</span>
          <div style={{marginLeft:"auto",display:"flex",gap:10,alignItems:"center"}}>
            <span style={{background:rc+"22",color:rc,border:`1px solid ${rc}44`,padding:"5px 14px",borderRadius:20,fontSize:11,fontWeight:800}}>{s?.risk?.toUpperCase()} RISK</span>
            <span style={{background:"#111827",color:"#64748b",padding:"5px 12px",borderRadius:8,fontSize:11,fontFamily:"monospace",fontWeight:700}}>SCORE {s?.score}/100</span>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:24,maxWidth:1280,margin:"0 auto",padding:"28px 32px"}}>
          <div>
            {/* Hero banner */}
            <div style={{background:`linear-gradient(135deg, ${cc.bg} 0%, #0b0f1a 100%)`,border:`1px solid ${cc.border}`,borderRadius:16,padding:"26px 28px",marginBottom:18}}>
              <div style={{display:"flex",gap:18,alignItems:"flex-start"}}>
                <div style={{width:60,height:60,background:cc.badge,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0,border:`1px solid ${cc.border}`}}>
                  {s?.icon}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:22,fontWeight:800,marginBottom:6}}>{s?.label}</div>
                  <div style={{fontSize:13,color:"#94a3b8",lineHeight:1.65,marginBottom:16}}>{s?.desc}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                    {[["Vendor",`${selected.vendor} (${selected.vcode})`],["Amount",fmt(selected.amount)],["PO Number",selected.poNum||"—"],["Invoice",selected.invNum||"—"],["Date",selected.date||"—"],["Approved By",selected.approvedBy||"—"]].map(([k,v]) => (
                      <div key={k} style={{background:"rgba(0,0,0,.35)",border:`1px solid ${cc.border}`,borderRadius:9,padding:"8px 14px",minWidth:110}}>
                        <div style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:".7px",marginBottom:3}}>{k}</div>
                        <div style={{fontSize:12,fontWeight:700,color:cc.accent}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Finding detail callout */}
            <div className="info-block" style={{borderLeft:`3px solid ${rc}`,background:"rgba(15,23,42,.8)"}}>
              <div style={{fontSize:10,color:rc,textTransform:"uppercase",letterSpacing:"1px",marginBottom:10,fontFamily:"monospace",fontWeight:700}}>🚩 FINDING DETAIL — FROM YOUR REAL DATA</div>
              <p style={{fontSize:14,lineHeight:1.85,color:"#cbd5e1"}}>{selected.detail}</p>
            </div>

            {/* Tabs */}
            <div style={{borderBottom:"1px solid #1e293b",marginBottom:20,display:"flex",gap:0,overflowX:"auto"}}>
              {[["overview","📋 Overview"],["redflags","🚨 Red Flags"],["auditsteps","✅ Audit Steps"],["controls","🛡️ Controls & SQL"],["ai","✨ AI Insight"]].map(([t,l]) => (
                <button key={t} style={dtabStyle(t)} onClick={() => setDetailTab(t)}>{l}</button>
              ))}
            </div>

            {detailTab==="overview" && <>
              <div className="info-block">
                <div style={{fontSize:11,color:cc.accent,fontWeight:800,marginBottom:12}}>📖 WHAT IS THIS SCENARIO?</div>
                <p style={{fontSize:13,lineHeight:1.9,color:"#cbd5e1"}}>{s?.what || s?.desc}</p>
              </div>
              <div className="info-block">
                <div style={{fontSize:11,color:cc.accent,fontWeight:800,marginBottom:12}}>❓ WHY DOES IT HAPPEN?</div>
                <p style={{fontSize:13,lineHeight:1.9,color:"#cbd5e1"}}>{s?.why || "Common control gap."}</p>
              </div>
              <div className="info-block">
                <div style={{fontSize:11,color:"#38bdf8",fontWeight:800,marginBottom:12}}>🗄️ DETECTION LOGIC APPLIED</div>
                <div style={{background:"#060a12",border:"1px solid #0f172a",borderRadius:9,padding:"14px 18px",fontFamily:"monospace",fontSize:12,color:"#7dd3fc",lineHeight:1.8}}>
                  {s?.sqlLogic}
                </div>
              </div>
              {s?.regulation && (
                <div className="info-block" style={{borderLeft:"3px solid #fbbf24",background:"rgba(120,80,0,.1)"}}>
                  <div style={{fontSize:11,color:"#fbbf24",fontWeight:800,marginBottom:8}}>⚖️ REGULATORY / COMPLIANCE NOTE</div>
                  <p style={{fontSize:13,lineHeight:1.8,color:"#fde68a"}}>{s.regulation}</p>
                </div>
              )}
            </>}

            {detailTab==="redflags" && (
              <div className="info-block">
                <div style={{fontSize:11,color:"#f87171",fontWeight:800,marginBottom:18}}>🚨 KEY RED FLAGS FOR THIS SCENARIO</div>
                {(s?.redFlags || []).map((flag, i) => (
                  <div key={i} style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:16,paddingBottom:16,borderBottom:i<(s.redFlags?.length-1)?`1px solid #1e293b`:"none"}}>
                    <div className="step-num" style={{background:"rgba(127,29,29,.7)",color:"#f87171",border:"1px solid rgba(248,113,113,.3)"}}>{i+1}</div>
                    <p style={{fontSize:13,lineHeight:1.8,color:"#fca5a5",paddingTop:4}}>{flag}</p>
                  </div>
                ))}
              </div>
            )}

            {detailTab==="auditsteps" && (
              <div className="info-block">
                <div style={{fontSize:11,color:"#4ade80",fontWeight:800,marginBottom:18}}>✅ RECOMMENDED AUDIT ACTIONS</div>
                {(s?.auditSteps || []).map((step, i) => (
                  <div key={i} style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:18,paddingBottom:18,borderBottom:i<(s.auditSteps?.length-1)?`1px solid #1e293b`:"none"}}>
                    <div className="step-num" style={{background:"rgba(20,83,45,.7)",color:"#4ade80",border:"1px solid rgba(74,222,128,.3)",fontSize:12}}>✓{i+1}</div>
                    <p style={{fontSize:13,lineHeight:1.8,color:"#bbf7d0",paddingTop:4}}>{step}</p>
                  </div>
                ))}
              </div>
            )}

            {detailTab==="controls" && <>
              <div className="info-block">
                <div style={{fontSize:11,color:"#38bdf8",fontWeight:800,marginBottom:18}}>🛡️ PREVENTIVE CONTROLS TO IMPLEMENT</div>
                {(s?.controls || []).map((ctrl, i) => (
                  <div key={i} style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:16,paddingBottom:16,borderBottom:i<(s.controls?.length-1)?`1px solid #1e293b`:"none"}}>
                    <div className="step-num" style={{background:"rgba(7,89,133,.7)",color:"#38bdf8",border:"1px solid rgba(56,189,248,.3)",fontSize:16}}>🔒</div>
                    <p style={{fontSize:13,lineHeight:1.8,color:"#bae6fd",paddingTop:4}}>{ctrl}</p>
                  </div>
                ))}
              </div>
              <div className="info-block">
                <div style={{fontSize:11,color:"#94a3b8",fontWeight:800,marginBottom:14,fontFamily:"monospace"}}>RISK SCORE BREAKDOWN</div>
                <div style={{display:"flex",gap:20,alignItems:"center",marginBottom:16}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#64748b",marginBottom:7}}>
                      <span>Composite Risk Score</span>
                      <span style={{color:rc,fontWeight:700}}>{s?.score}/100</span>
                    </div>
                    <div style={{background:"#111827",borderRadius:8,height:12,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${s?.score}%`,background:`linear-gradient(90deg,${rc},${rc}88)`,borderRadius:8,transition:"width .6s"}}/>
                    </div>
                  </div>
                  <div style={{textAlign:"center",minWidth:70}}>
                    <div style={{fontSize:32,fontWeight:800,color:rc,fontFamily:"monospace"}}>{s?.score}</div>
                    <div style={{fontSize:10,color:"#475569"}}>/100</div>
                  </div>
                </div>
              </div>
            </>}

            {detailTab==="ai" && (
              <div style={{background:"rgba(10,4,25,.9)",border:"1px solid rgba(124,58,237,.3)",borderRadius:13,padding:"22px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:800,color:"#c084fc"}}>✨ AI Audit Intelligence</div>
                    <div style={{fontSize:11,color:"#64748b",marginTop:3}}>Root cause · Risk implications · Audit actions · SQL query</div>
                  </div>
                  <button onClick={() => getAI(selected)} disabled={aiLoading}
                          style={{background:"linear-gradient(135deg,#7c3aed,#3b82f6)",border:"none",color:"#fff",padding:"11px 22px",borderRadius:9,cursor:"pointer",fontSize:12,fontWeight:700,opacity:aiLoading?.5:1,fontFamily:"'Inter',sans-serif"}}>
                    {aiLoading ? "Analyzing…" : "Generate AI Insight"}
                  </button>
                </div>
                {aiText ? (
                  <div style={{background:"#040208",border:"1px solid #1e0a40",borderRadius:10,padding:"18px",fontSize:13,lineHeight:1.95,color:"#e2e8f0"}}>
                    <pre style={{fontFamily:"'Inter','Segoe UI',sans-serif"}}>{aiText}</pre>
                  </div>
                ) : !aiLoading && (
                  <div style={{textAlign:"center",color:"#334155",fontSize:13,padding:"28px 0"}}>
                    <div style={{fontSize:36,marginBottom:10}}>🤖</div>
                    Click <strong style={{color:"#a78bfa"}}>Generate AI Insight</strong> to get expert audit analysis,<br/>
                    root cause, and an investigation SQL query for this real finding.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:"#111827",border:`1px solid ${cc.border}`,borderRadius:13,padding:"16px 18px"}}>
              <div style={{fontSize:10,color:cc.accent,fontWeight:800,letterSpacing:"1.2px",marginBottom:14,fontFamily:"monospace"}}>SCENARIO INFO</div>
              {[["ID",s?.id],["Category",s?.cat],["Risk Level",s?.risk],["Risk Score",`${s?.score}/100`],["Data Source","Real Excel Upload"],["Engine","Live Parsing"]].map(([k,v]) => (
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1e293b44",fontSize:12}}>
                  <span style={{color:"#64748b"}}>{k}</span>
                  <span style={{color:cc.accent,fontWeight:700}}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:13,padding:"16px 18px"}}>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:800,letterSpacing:"1.2px",marginBottom:14,fontFamily:"monospace"}}>REVIEW STATUS</div>
              {[["🔴 Open","#f87171","Open"],["🟡 Under Review","#fbbf24","Under Review"],["🟢 Cleared","#4ade80","Cleared"],["⚫ Confirmed Fraud","#e2e8f0","Confirmed Fraud"]].map(([label,color,val]) => (
                <div key={val} onClick={() => setReviewStatus(prev => ({...prev,[selected.id]:val}))}
                     style={{background:curStatus===val?"rgba(30,41,59,.9)":"#0f172a",border:`1px solid ${curStatus===val?color+"55":"#1e293b"}`,borderRadius:8,padding:"9px 13px",marginBottom:8,cursor:"pointer",fontSize:12,color:curStatus===val?color:"#64748b",fontWeight:curStatus===val?700:500,display:"flex",alignItems:"center",justifyContent:"space-between",transition:"all .15s"}}>
                  {label}
                  {curStatus===val && <span style={{fontSize:14}}>✓</span>}
                </div>
              ))}
            </div>

            {related.length > 0 && (
              <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:13,padding:"16px 18px"}}>
                <div style={{fontSize:10,color:"#94a3b8",fontWeight:800,letterSpacing:"1.2px",marginBottom:14,fontFamily:"monospace"}}>RELATED FINDINGS</div>
                {related.map(rf => {
                  const rs = getSc(rf.scenario);
                  return (
                    <div key={rf.id} onClick={() => openDetail(rf)}
                         style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:9,padding:"11px 13px",marginBottom:8,cursor:"pointer",transition:"all .15s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,alignItems:"center"}}>
                        <span style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{rs?.label}</span>
                        <span style={{fontSize:9,color:RISK_COL[rs?.risk],fontWeight:800,background:RISK_COL[rs?.risk]+"20",padding:"2px 6px",borderRadius:4}}>{rs?.risk}</span>
                      </div>
                      <div style={{fontSize:11,color:"#475569"}}>{rf.vendor} · {fmt(rf.amount)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────
  //  RESULTS DASHBOARD
  // ──────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#080b14",color:"#e2e8f0"}}>
      <style>{CSS}</style>
      <div style={{background:"#0b0f1a",borderBottom:"1px solid #1e293b",padding:"14px 36px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,background:"linear-gradient(135deg,#3b82f6,#7c3aed)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>🔎</div>
          <div>
            <div style={{fontWeight:800,fontSize:15}}>P2P Audit Intelligence</div>
            <div style={{fontSize:10,color:"#475569",letterSpacing:"1px",fontFamily:"monospace"}}>
              REAL DATA ANALYSIS COMPLETE · {findings.length} FINDINGS · {files.map(f=>f.name).join(", ")}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={exportExcel} style={{background:"rgba(20,83,45,.7)",border:"1px solid rgba(74,222,128,.3)",color:"#4ade80",padding:"8px 18px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Inter',sans-serif"}}>📥 Export Excel</button>
          <button onClick={() => { setPhase("upload"); setFiles([]); setFileObjs([]); setFindings([]); }}
                  style={{background:"#111827",border:"1px solid #1e293b",color:"#94a3b8",padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"'Inter',sans-serif"}}>+ New Analysis</button>
        </div>
      </div>

      <div style={{padding:"26px 36px"}}>
        {/* KPI row */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:13,marginBottom:22}}>
          {[
            {label:"Total Findings",val:findings.length,       color:"#60a5fa",icon:"📋"},
            {label:"High Risk",     val:highC,                 color:"#f87171",icon:"🔴"},
            {label:"Medium Risk",   val:medC,                  color:"#fb923c",icon:"🟠"},
            {label:"Low Risk",      val:lowC,                  color:"#facc15",icon:"🟡"},
            {label:"Total Exposure",val:fmt(expTot),           color:"#a78bfa",icon:"💰"},
          ].map(k => (
            <div key={k.label} className="kpi-card">
              <div style={{fontSize:22,marginBottom:6}}>{k.icon}</div>
              <div style={{fontSize:k.label==="Total Exposure"?20:30,fontWeight:800,color:k.color,fontFamily:"monospace"}}>{k.val}</div>
              <div style={{fontSize:11,color:"#64748b",marginTop:4}}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Scenario coverage strip */}
        <div style={{background:"#111827",border:"1px solid #1e293b",borderRadius:12,padding:"13px 18px",marginBottom:20,display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:"#334155",textTransform:"uppercase",letterSpacing:"1.2px",fontFamily:"monospace",marginRight:6}}>SCENARIOS CHECKED:</span>
          {SC_LIST.map(s => {
            const hit = findings.find(f => f.scenario === s.id);
            const cc2 = CAT_COLOR[s.cat];
            return (
              <span key={s.id} title={s.label} style={{background:hit?cc2.badge:"#0f172a",color:hit?cc2.accent:"#334155",border:`1px solid ${hit?cc2.border:"#1e293b"}`,padding:"2px 8px",borderRadius:5,fontSize:9,fontWeight:700,cursor:"default"}}>
                {s.id}{hit?" ⚑":""}
              </span>
            );
          })}
        </div>

        {/* Tabs */}
        <div style={{borderBottom:"1px solid #1e293b",marginBottom:20,display:"flex"}}>
          {[["findings",`🚩 All Findings (${filtered.length})`],["vendors","🏢 Vendor Risk"],["summary","📊 Summary"]].map(([t,l]) => (
            <button key={t} className={`tab ${activeTab===t?"on":""}`} onClick={() => setActiveTab(t)}>{l}</button>
          ))}
        </div>

        {/* FINDINGS TAB */}
        {activeTab==="findings" && <>
          <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:10,color:"#475569",marginRight:2}}>Category:</span>
            {cats.map(c => <button key={c} className={`fbtn ${catFilter===c?"on":""}`} onClick={() => setCatFilter(c)}>{c}</button>)}
            <span style={{fontSize:10,color:"#475569",marginLeft:10,marginRight:2}}>Risk:</span>
            {["All","High","Medium","Low"].map(r => (
              <button key={r} className={`fbtn ${riskFilter===r?"on":""}`} onClick={() => setRiskFilter(r)}
                      style={riskFilter===r&&r!=="All"?{borderColor:RISK_COL[r],color:RISK_COL[r],background:RISK_COL[r]+"15"}:{}}>{r}</button>
            ))}
            <span style={{fontSize:10,color:"#475569",marginLeft:10,marginRight:2}}>Sort:</span>
            {[["risk","Risk"],["amount","Amount"],["id","#"]].map(([v,l]) => (
              <button key={v} className={`fbtn ${sortBy===v?"on":""}`} onClick={() => setSortBy(v)}>{l}</button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div style={{textAlign:"center",color:"#334155",fontSize:13,padding:"48px 0"}}>
              <div style={{fontSize:36,marginBottom:10}}>🔍</div>
              No findings match the current filter.
            </div>
          ) : filtered.map(f => {
            const s   = getSc(f.scenario);
            const cc2 = CAT_COLOR[s?.cat || "Invoice"];
            const fStatus = reviewStatus[f.id] || "Open";
            return (
              <div key={f.id} className="frow" onClick={() => openDetail(f)}>
                <div style={{width:38,height:38,background:RISK_COL[s?.risk]+"18",border:`1px solid ${RISK_COL[s?.risk]}44`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{fontSize:11,fontWeight:800,color:RISK_COL[s?.risk],fontFamily:"monospace"}}>{s?.score}</span>
                </div>
                <div style={{width:36,height:36,background:cc2.badge,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0,border:`1px solid ${cc2.border}`}}>
                  {s?.icon}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                    <span style={{fontSize:13,fontWeight:700,color:"#f1f5f9"}}>{s?.label}</span>
                    <span style={{background:cc2.badge,color:cc2.accent,padding:"1px 7px",borderRadius:5,fontSize:9,fontWeight:800,border:`1px solid ${cc2.border}`}}>{s?.cat}</span>
                    <span style={{background:RISK_COL[s?.risk]+"22",color:RISK_COL[s?.risk],padding:"1px 7px",borderRadius:5,fontSize:9,fontWeight:800}}>{s?.risk}</span>
                    <span style={{color:"#334155",fontSize:9,fontFamily:"monospace"}}>{f.scenario}</span>
                    {fStatus!=="Open" && <span style={{background:"rgba(20,83,45,.4)",color:"#4ade80",padding:"1px 7px",borderRadius:4,fontSize:9,fontWeight:700}}>{fStatus}</span>}
                  </div>
                  <div style={{fontSize:12,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.detail}</div>
                </div>
                <div style={{textAlign:"right",minWidth:110,flexShrink:0}}>
                  <div style={{fontSize:14,fontWeight:800,color:cc2.accent}}>{fmt(f.amount)}</div>
                  <div style={{fontSize:10,color:"#475569",marginTop:2}}>{f.vendor.length>18?f.vendor.slice(0,18)+"…":f.vendor}</div>
                </div>
                <div style={{color:"#334155",fontSize:18,fontWeight:700}}>›</div>
              </div>
            );
          })}
        </>}

        {/* VENDOR RISK TAB */}
        {activeTab==="vendors" && (
          <div>
            <div style={{fontSize:10,color:"#475569",marginBottom:16,fontFamily:"monospace"}}>COMPOSITE RISK SCORE = Weighted average from real finding data (High×3, Medium×1.5, Low×0.5)</div>
            {vendorScores.length === 0 ? (
              <div style={{textAlign:"center",color:"#334155",padding:"40px 0",fontSize:13}}>No vendor data available.</div>
            ) : vendorScores.map((v,i) => {
              const band = v.score>=80?"CRITICAL":v.score>=60?"HIGH":v.score>=40?"MEDIUM":"LOW";
              const bc   = v.score>=80?"#f87171":v.score>=60?"#fb923c":v.score>=40?"#facc15":"#4ade80";
              return (
                <div key={v.vcode} style={{background:"#111827",border:"1px solid #1e293b",borderRadius:11,padding:"14px 20px",marginBottom:9,display:"flex",alignItems:"center",gap:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#334155",fontFamily:"monospace",minWidth:28}}>#{i+1}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{v.vendor}</div>
                    <div style={{fontSize:11,color:"#475569"}}>{v.vcode} · {v.flags} flag{v.flags!==1?"s":""}</div>
                  </div>
                  <div style={{background:bc+"18",color:bc,border:`1px solid ${bc}44`,padding:"5px 14px",borderRadius:20,fontSize:11,fontWeight:800}}>{band}</div>
                  <div style={{minWidth:110}}>
                    <div style={{background:"#0f172a",borderRadius:6,height:8,overflow:"hidden",marginBottom:5}}>
                      <div style={{height:"100%",width:`${v.score}%`,background:`linear-gradient(90deg,${bc},${bc}88)`,borderRadius:6}}/>
                    </div>
                    <div style={{fontSize:11,color:bc,textAlign:"right",fontFamily:"monospace",fontWeight:700}}>{v.score}/100</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SUMMARY TAB */}
        {activeTab==="summary" && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14}}>
            {Object.keys(CAT_COLOR).map(cat => {
              const cf = findings.filter(f => getSc(f.scenario)?.cat === cat);
              if (!cf.length) return null;
              const cc2 = CAT_COLOR[cat];
              return (
                <div key={cat} style={{background:cc2.bg,border:`1px solid ${cc2.border}`,borderRadius:14,padding:"18px 22px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:15,fontWeight:800,color:cc2.accent}}>{cat}</div>
                    <span style={{background:cc2.badge,color:cc2.accent,border:`1px solid ${cc2.border}`,padding:"3px 12px",borderRadius:16,fontSize:11,fontWeight:800}}>{cf.length} findings</span>
                  </div>
                  {cf.map(f => {
                    const fsc = getSc(f.scenario);
                    return (
                      <div key={f.id} onClick={() => openDetail(f)}
                           style={{background:"rgba(0,0,0,.3)",borderRadius:8,padding:"10px 12px",marginBottom:7,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",border:"1px solid transparent",transition:"all .15s"}}>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:14}}>{fsc?.icon}</span>
                          <span style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>{fsc?.label}</span>
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                          {f.amount && <span style={{fontSize:11,color:cc2.accent,fontWeight:700}}>{fmt(f.amount)}</span>}
                          <span style={{color:RISK_COL[fsc?.risk],fontSize:9,fontWeight:800,background:RISK_COL[fsc?.risk]+"20",padding:"2px 6px",borderRadius:4}}>{fsc?.risk}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
