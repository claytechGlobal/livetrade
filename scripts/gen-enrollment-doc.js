const fs = require('fs');
const path = require('path');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseMd(md) {
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
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    if (t === 'Welcome to Ebron Holdings Inc.') {
      html.push('<h2 style="font-family:var(--display);font-size:22px;margin:0 0 4px;color:var(--text)">Welcome to Ebron Holdings Inc.</h2>');
      i++;
      if (i < lines.length && lines[i].trim() === 'Our Wealth Building Community') {
        html.push('<p style="font-family:var(--display);font-size:15px;color:var(--text-2);margin:0 0 20px">Our Wealth Building Community</p>');
        i++;
      }
      continue;
    }

    if (sectionHeaders.has(t.replace(/:$/, ''))) {
      html.push(`<h3 style="font-family:var(--display);font-size:16px;margin:28px 0 10px;color:var(--text);padding-bottom:6px;border-bottom:1px solid var(--line)">${esc(t.replace(/:$/, ''))}</h3>`);
      i++;
      continue;
    }

    if (subHeaders.has(t.replace(/:$/, ''))) {
      html.push(`<h4 style="font-family:var(--display);font-size:14px;margin:20px 0 10px;color:var(--text)">${esc(t.replace(/:$/, ''))}</h4>`);
      i++;
      continue;
    }

    if (t.startsWith('✅')) {
      const steps = [];
      while (i < lines.length && lines[i].trim().startsWith('✅')) {
        steps.push(esc(lines[i].trim().replace(/^✅\s*/, '')));
        i++;
      }
      html.push('<div style="display:grid;gap:8px;margin:12px 0 16px">' + steps.map(s =>
        `<div style="display:flex;align-items:flex-start;gap:10px;font-size:13px"><span style="color:var(--accent)">✅</span><span>${s}</span></div>`
      ).join('') + '</div>');
      continue;
    }

    if (/^[\uF0B7•]/.test(t) || t.startsWith('oBusiness') || t.startsWith('oPersonal')) {
      const items = [];
      while (i < lines.length) {
        const lt = lines[i].trim();
        if (/^[\uF0B7•]/.test(lt) || lt.startsWith('oBusiness') || lt.startsWith('oPersonal')) {
          items.push(esc(lt.replace(/^[\uF0B7•]\s*/, '').replace(/^o/, '')));
          i++;
        } else break;
      }
      html.push('<ul style="margin:0 0 14px;padding-left:20px">' + items.map(it => {
        const sub = it.startsWith('Business') || it.startsWith('Personal');
        return `<li style="margin-bottom:6px${sub ? ';list-style:none;padding-left:8px' : ''}">${sub ? '○ ' : ''}${it}</li>`;
      }).join('') + '</ul>');
      continue;
    }

    if (t.startsWith('• ')) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith('• ')) {
        items.push(esc(lines[i].trim().replace(/^•\s*/, '')));
        i++;
      }
      html.push('<ul style="margin:0 0 14px;padding-left:20px">' + items.map(it => `<li style="margin-bottom:6px">${it}</li>`).join('') + '</ul>');
      continue;
    }

    if (/^[○□]/.test(t) && !/^\d+\./.test(t)) {
      const label = t.replace(/^[○□]\s*/, '');
      const opts = [];
      while (i < lines.length && /^[○□]/.test(lines[i].trim()) && !/^\d+\./.test(lines[i].trim())) {
        opts.push(esc(lines[i].trim().replace(/^[○□]\s*/, '')));
        i++;
      }
      const isRadio = label.includes('Range') || label.includes('Tolerance') || label.includes('Markets');
      if (isRadio && opts.length) {
        html.push(`<div style="margin:8px 0 14px"><div style="color:var(--text);font-size:13px;margin-bottom:8px;font-weight:600">${esc(label)}</div><div style="display:flex;flex-wrap:wrap;gap:12px 20px">${opts.map(o => `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="width:14px;height:14px;border:1px solid var(--line);border-radius:50%;flex-shrink:0"></span>${o}</label>`).join('')}</div></div>`);
      } else {
        html.push(`<div style="margin:8px 0 14px"><div style="display:flex;flex-wrap:wrap;gap:12px 20px">${opts.map(o => `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="width:14px;height:14px;border:1px solid var(--line);border-radius:3px;flex-shrink:0"></span>${o}</label>`).join('')}</div></div>`);
      }
      continue;
    }

    if (t.startsWith('☐')) {
      const opts = [];
      while (i < lines.length && lines[i].trim().startsWith('☐')) {
        opts.push(esc(lines[i].trim().replace(/^☐\s*/, '')));
        i++;
      }
      html.push('<div style="display:flex;flex-wrap:wrap;gap:12px 20px;margin:8px 0 14px">' + opts.map(o =>
        `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="width:14px;height:14px;border:1px solid var(--line);border-radius:3px;flex-shrink:0"></span>${o}</label>`
      ).join('') + '</div>');
      continue;
    }

    if (t.startsWith('____')) {
      const items = [];
      while (i < lines.length && lines[i].trim().startsWith('____')) {
        items.push(esc(lines[i].trim().replace(/^____\s*/, '')));
        i++;
      }
      html.push('<div style="display:grid;gap:6px;margin:8px 0 14px">' + items.map(it =>
        `<label style="display:flex;align-items:flex-start;gap:8px;font-size:13px"><span style="width:16px;height:16px;border:1px solid var(--line);border-radius:3px;flex-shrink:0;margin-top:2px"></span><span>${it}</span></label>`
      ).join('') + '</div>');
      continue;
    }

    if (t === 'Client Initials: ______' || t === 'Client Initials: _________' || t.startsWith('Client Initials:')) {
      html.push('<div style="margin:14px 0;display:flex;align-items:center;gap:12px;font-size:13px"><span>Client Initials:</span><span style="border-bottom:1px solid var(--line);width:80px;min-height:22px"></span></div>');
      i++;
      continue;
    }

    if (/^\d+\./.test(t)) {
      html.push(`<p style="margin:14px 0 8px;font-weight:600;color:var(--text);font-size:13px">${esc(t)}</p>`);
      i++;
      while (i < lines.length && /^[☐○]/.test(lines[i].trim())) {
        const opts = [];
        while (i < lines.length && /^[☐○]/.test(lines[i].trim())) {
          opts.push(esc(lines[i].trim().replace(/^[☐○]\s*/, '')));
          i++;
        }
        html.push('<div style="display:flex;flex-wrap:wrap;gap:12px 20px;margin-bottom:8px">' + opts.map(o =>
          `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><span style="width:14px;height:14px;border:1px solid var(--line);border-radius:3px;flex-shrink:0"></span>${o}</label>`
        ).join('') + '</div>');
      }
      if (i < lines.length && (lines[i].trim().startsWith('If yes') || lines[i].trim().startsWith('Business Name'))) {
        html.push(`<p style="margin:0 0 12px;font-size:13px;color:var(--text-3)">${esc(lines[i].trim())}</p>`);
        i++;
      }
      continue;
    }

    if (t.includes('________________') || t.includes('__________')) {
      const parts = t.split(/\s{2,}/).filter(Boolean);
      if (parts.length > 1) {
        parts.forEach(part => {
          const idx = part.indexOf(':');
          if (idx > 0) {
            html.push(`<div style="display:grid;grid-template-columns:minmax(140px,auto) 1fr;gap:8px 16px;margin:8px 0;align-items:end"><span style="color:var(--text);font-size:13px">${esc(part.slice(0, idx + 1))}</span><span style="border-bottom:1px solid var(--line);min-height:22px"></span></div>`);
          }
        });
      } else {
        const idx = t.indexOf(':');
        if (idx > 0) {
          html.push(`<div style="display:grid;grid-template-columns:minmax(140px,auto) 1fr;gap:8px 16px;margin:8px 0;align-items:end"><span style="color:var(--text);font-size:13px">${esc(t.slice(0, idx + 1))}</span><span style="border-bottom:1px solid var(--line);min-height:22px"></span></div>`);
        } else {
          html.push('<div style="border-bottom:1px solid var(--line);min-height:22px;margin:8px 0"></div>');
        }
      }
      i++;
      continue;
    }

    if (t === 'Initial Each:') {
      html.push('<p style="margin:0 0 8px;font-weight:600;color:var(--text);font-size:13px">Initial Each:</p>');
      i++;
      continue;
    }

    if (t.startsWith('(Check all')) {
      html.push(`<p style="margin:0 0 8px;font-size:13px;color:var(--text-3)">${esc(t)}</p>`);
      i++;
      continue;
    }

    if (t === 'CLIENT' || t === 'EBRON HOLDINGS INC.') {
      html.push(`<h4 style="font-family:var(--display);font-size:14px;margin:20px 0 8px;color:var(--text)">${esc(t)}</h4>`);
      i++;
      continue;
    }

    html.push(`<p style="margin:0 0 12px">${esc(t)}</p>`);
    i++;
  }

  return html.join('');
}

const contractMd = fs.readFileSync(path.join(__dirname, '..', 'contract.md'), 'utf8');
const policyMd = fs.readFileSync(path.join(__dirname, '..', 'policy.md'), 'utf8');
const contractBody = parseMd(contractMd);
const policyBody = parseMd(policyMd);

const snippet = `function contractHtml(){return \`<div style="font-size:13.5px;color:var(--text-2);line-height:1.7;max-width:860px">${contractBody}</div>\`;}
function policyHtml(){return \`<div style="font-size:13.5px;color:var(--text-2);line-height:1.7;max-width:860px">${policyBody}</div>\`;}
`;

fs.writeFileSync(path.join(__dirname, '..', 'public', 'enrollment-doc.js'), snippet);
console.log('Wrote enrollment-doc.js', snippet.length, 'chars');
