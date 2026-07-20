const fs = require('fs');
const path = require('path');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let fieldN = 0;
function fid(prefix) { fieldN++; return `${prefix}_${fieldN}`; }

function inp(name, placeholder) {
  return `<input class="contract-inp" name="${name}" type="text" placeholder="${esc(placeholder || '')}" autocomplete="off">`;
}

function initials() {
  const id = fid('ini');
  return `<div class="contract-initials"><span>Client Initials:</span><input class="contract-inp contract-ini" name="${id}" type="text" maxlength="6" placeholder="XX" autocomplete="off"></div>`;
}

function parseContractMd(md) {
  fieldN = 0;
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;

  const sectionHeaders = new Set([
    'Your Next Steps', 'Our Commitment to You', 'Together We Build More Than Wealth',
    'Risk Acknowledgement', 'Understanding how our system operates',
    'Payouts are Subject to the Following', 'Client Responsibilities',
    'Understanding Ebron Holdings Responsibilities', 'Program Risk Policies',
    'Program Policies Grounds for Removal', 'AML Statement', 'Choose Your Package',
    'Client Agreement', 'Electronic Signature Consent', 'Signatures',
    'Client Eligibility & Suitability Assessment', 'Congratulations, and welcome!'
  ]);

  const subHeaders = new Set([
    'Trading Experience', 'Financial Understanding', 'Legal & Compliance',
    'Client Expectations', 'Community Commitment', 'Client Information',
    'Income Range', "Number of YEARS' trading", 'What Is Your Risk Tolerance',
    'What Markets Have You Traded', 'After Prop Firm approval has been received',
    'Payouts are made by'
  ]);

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    if (t === 'Welcome to Ebron Holdings Inc.') {
      html.push('<h2 class="contract-h2">Welcome to Ebron Holdings Inc.</h2>');
      i++;
      if (i < lines.length && lines[i].trim() === 'Our Wealth Building Community') {
        html.push('<p class="contract-sub">Our Wealth Building Community</p>');
        i++;
      }
      continue;
    }

    if (sectionHeaders.has(t.replace(/:$/, ''))) {
      html.push(`<h3 class="contract-h3">${esc(t.replace(/:$/, ''))}</h3>`);
      i++;
      continue;
    }

    if (subHeaders.has(t.replace(/:$/, ''))) {
      html.push(`<h4 class="contract-h4">${esc(t.replace(/:$/, ''))}</h4>`);
      i++;
      continue;
    }

    if (t.startsWith('✅')) {
      const steps = [];
      while (i < lines.length && lines[i].trim().startsWith('✅')) {
        steps.push(esc(lines[i].trim().replace(/^✅\s*/, '')));
        i++;
      }
      html.push('<div class="contract-steps">' + steps.map(s =>
        `<div class="contract-step"><span>✅</span><span>${s}</span></div>`
      ).join('') + '</div>');
      continue;
    }

    if (/^[\uF0B7•]/.test(t) || t.startsWith('oBusiness') || t.startsWith('oPersonal')) {
      const items = [];
      while (i < lines.length) {
        const lt = lines[i].trim();
        if (/^[\uF0B7•]/.test(lt) || lt.startsWith('oBusiness') || lt.startsWith('oPersonal')) {
          items.push(lt.replace(/^[\uF0B7•]\s*/, '').replace(/^o/, ''));
          i++;
        } else break;
      }
      if (items.some(x => x.startsWith('Business') || x.startsWith('Personal') || x === 'ACH' || x.includes('Stripe'))) {
        const g = fid('pay');
        html.push('<div class="contract-opts">' + items.map(it => {
          const sub = it.startsWith('Business') || it.startsWith('Personal');
          const name = sub ? `${g}_bank` : g;
          const type = sub ? 'radio' : 'checkbox';
          return `<label class="contract-opt${sub ? ' contract-opt-sub' : ''}"><input type="${type}" name="${name}" value="${esc(it)}"><span>${esc(it)}</span></label>`;
        }).join('') + '</div>');
      } else {
        html.push('<ul class="contract-ul">' + items.map(it => {
          const sub = it.startsWith('Business') || it.startsWith('Personal');
          return `<li${sub ? ' class="contract-li-sub"' : ''}>${sub ? '○ ' : ''}${esc(it)}</li>`;
        }).join('') + '</ul>');
      }
      continue;
    }

    if (t.startsWith('• ')) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith('• ')) {
        items.push(esc(lines[i].trim().replace(/^•\s*/, '')));
        i++;
      }
      html.push('<ul class="contract-ul">' + items.map(it => `<li>${it}</li>`).join('') + '</ul>');
      continue;
    }

    if (/^[○□]/.test(t) && !/^\d+\./.test(t)) {
      const opts = [];
      while (i < lines.length && /^[○□]/.test(lines[i].trim()) && !/^\d+\./.test(lines[i].trim())) {
        opts.push(lines[i].trim().replace(/^[○□]\s*/, ''));
        i++;
      }
      const g = fid('opt');
      const isRadio = /^○/.test(t) || opts.some(o => /Under \$50K|Conservative|Moderate|Aggressive|None|Less than/.test(o));
      html.push('<div class="contract-opts">' + opts.map(o =>
        `<label class="contract-opt"><input type="${isRadio ? 'radio' : 'checkbox'}" name="${isRadio ? g : fid('cb')}" value="${esc(o)}"><span>${esc(o)}</span></label>`
      ).join('') + '</div>');
      continue;
    }

    if (t.startsWith('☐')) {
      const opts = [];
      while (i < lines.length && lines[i].trim().startsWith('☐')) {
        opts.push(lines[i].trim().replace(/^☐\s*/, ''));
        i++;
      }
      html.push('<div class="contract-opts">' + opts.map(o =>
        `<label class="contract-opt"><input type="checkbox" name="${fid('cb')}" value="${esc(o)}"><span>${esc(o)}</span></label>`
      ).join('') + '</div>');
      continue;
    }

    if (t.startsWith('____')) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith('____')) {
        items.push(lines[i].trim().replace(/^____\s*/, ''));
        i++;
      }
      html.push('<div class="contract-acks">' + items.map(it =>
        `<label class="contract-ack"><input type="checkbox" name="${fid('ack')}" value="${esc(it)}"><span>${esc(it)}</span></label>`
      ).join('') + '</div>');
      continue;
    }

    if (t.startsWith('Client Initials:')) {
      html.push(initials());
      i++;
      continue;
    }

    if (/^\d+\./.test(t)) {
      html.push(`<p class="contract-q">${esc(t)}</p>`);
      i++;
      while (i < lines.length && /^[☐○]/.test(lines[i].trim())) {
        const opts = [];
        const first = lines[i].trim();
        const isRadio = first.startsWith('○') || /Yes|No|Individual|Business/.test(first);
        while (i < lines.length && /^[☐○]/.test(lines[i].trim())) {
          opts.push(lines[i].trim().replace(/^[☐○]\s*/, ''));
          i++;
        }
        const g = fid('q');
        html.push('<div class="contract-opts">' + opts.map(o =>
          `<label class="contract-opt"><input type="${isRadio ? 'radio' : 'checkbox'}" name="${isRadio ? g : fid('cb')}" value="${esc(o)}"><span>${esc(o)}</span></label>`
        ).join('') + '</div>');
      }
      if (i < lines.length && (lines[i].trim().startsWith('If yes') || lines[i].trim().startsWith('Business Name'))) {
        const label = lines[i].trim();
        html.push(`<div class="contract-field"><label>${esc(label)}</label>${inp(fid('txt'), 'Type here...')}</div>`);
        i++;
      }
      continue;
    }

    if (t.includes('________________') || t.includes('__________')) {
      const parts = t.split(/\s{2,}/).filter(Boolean);
      const fields = parts.length > 1 ? parts : [t];
      fields.forEach(part => {
        const idx = part.indexOf(':');
        if (idx > 0) {
          html.push(`<div class="contract-field"><label>${esc(part.slice(0, idx + 1))}</label>${inp(fid('fld'), '')}</div>`);
        }
      });
      i++;
      continue;
    }

    if (t === 'Initial Each:') {
      html.push('<p class="contract-strong">Initial Each:</p>');
      i++;
      continue;
    }

    if (t.startsWith('(Check all')) {
      html.push(`<p class="contract-muted">${esc(t)}</p>`);
      i++;
      continue;
    }

    if (t === 'CLIENT' || t === 'EBRON HOLDINGS INC.') {
      html.push(`<h4 class="contract-h4">${esc(t)}</h4>`);
      i++;
      continue;
    }

    if (t.startsWith('I certify') || t.startsWith('I consent') || t.startsWith('By signing')) {
      html.push(`<label class="contract-ack"><input type="checkbox" name="${fid('agree')}" value="${esc(t)}"><span>${esc(t)}</span></label>`);
      i++;
      continue;
    }

    if (t.startsWith('Why do you want')) {
      html.push(`<div class="contract-field"><label>${esc(t)}</label><textarea class="contract-ta" name="${fid('why')}" rows="3" placeholder="Type your answer..."></textarea></div>`);
      i++;
      continue;
    }

    html.push(`<p class="contract-p">${esc(t)}</p>`);
    i++;
  }

  return html.join('');
}

function parseTermsMd(md) {
  const lines = md.split(/\r?\n/);
  const html = [];
  let i = 0;
  let titleLines = [];

  while (i < lines.length && lines[i].trim() && !/^(Applies to|Effective date|Contact)\b/.test(lines[i].trim()) && !/^\d+\.\s/.test(lines[i].trim()) && !lines[i].trim().startsWith('By accessing')) {
    titleLines.push(lines[i].trim());
    i++;
  }
  if (titleLines.length) {
    html.push(`<h2 class="contract-h2">${esc(titleLines.join(' '))}</h2>`);
  }

  while (i < lines.length && !lines[i].trim()) i++;

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; break; }
    if (/^(Applies to|Effective date|Contact)\b/i.test(t)) {
      i++;
      continue;
    }
    break;
  }

  while (i < lines.length && !lines[i].trim()) i++;

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }

    if (/^\d+\.\s/.test(t)) {
      html.push(`<h3 class="contract-h3">${esc(t)}</h3>`);
      i++;
      continue;
    }

    if (t === 'Contact Information') {
      html.push(`<h3 class="contract-h3">${esc(t)}</h3>`);
      i++;
      continue;
    }

    if (/^[\uF0B7•]/.test(t)) {
      const items = [];
      while (i < lines.length && /^[\uF0B7•]/.test(lines[i].trim())) {
        items.push(esc(lines[i].trim().replace(/^[\uF0B7•]\s*/, '')));
        i++;
      }
      html.push('<ul class="contract-ul">' + items.map(it => `<li>${it}</li>`).join('') + '</ul>');
      continue;
    }

    if (t.startsWith('Users agree not to:')) {
      html.push(`<p class="contract-strong">${esc(t)}</p>`);
      i++;
      continue;
    }

    if (t.startsWith('Affiliate commissions:')) {
      html.push(`<p class="contract-strong">${esc(t)}</p>`);
      i++;
      continue;
    }

    if (t.startsWith('Unless expressly stated otherwise')) {
      html.push(`<p class="contract-strong">${esc(t)}</p>`);
      i++;
      continue;
    }

    html.push(`<p class="contract-p">${esc(t)}</p>`);
    i++;
  }

  return html.join('');
}

const root = path.join(__dirname, '..');
const contractMd = fs.readFileSync(path.join(root, 'contract.md'), 'utf8');
const termsMd = fs.readFileSync(path.join(root, 'termndpolicies.md'), 'utf8');
const contractBody = parseContractMd(contractMd);
const policyBody = parseTermsMd(termsMd);

const snippet = `function contractHtml(){return \`<form id="contractForm" class="contract-doc" onsubmit="return submitContract(event)">${contractBody}<div class="contract-sign-bar"><button type="submit" class="btn primary">Sign &amp; Submit Contract</button><span class="hint" style="font-family:var(--ui)">Fill required fields, select options, and add your initials before signing.</span></div></form>\`;}
function policyHtml(){return \`<div class="contract-doc">${policyBody}</div>\`;}
`;

fs.writeFileSync(path.join(root, 'public', 'enrollment-doc.js'), snippet);
console.log('Wrote enrollment-doc.js', snippet.length, 'chars');
