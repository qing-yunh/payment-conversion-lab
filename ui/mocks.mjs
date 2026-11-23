                                                                                    
                                                                                                                            
const F = (label, mark = '', kind = 'input') => ({ label, mark, kind });
const row = (...fields) => fields;

                                                                                  
export const TREATMENTS = Object.freeze({
  'R-FF1': {
    summary: 'Two-column form with 14 inputs → one column with 8 inputs, wallets first.',
    a: { title: 'A · current checkout', rows: [row(F('Email')), row(F('First name', 'gone'), F('Last name', 'gone')), row(F('Phone (optional)', 'gone')), row(F('Address line 1')), row(F('Address line 2', 'gone')),
      row(F('Town or city'), F('Postcode')), row(F('Country', 'gone')), row(F('Create an account', 'moved', 'check')), row(F('Card number')), row(F('Expiry'), F('CVC')), row(F('Name on card', 'gone'))] },
    b: { title: 'B · simplified form', rows: [row(F('Apple Pay', 'new', 'wallet'), F('Google Pay', 'new', 'wallet')), row(F('Email')), row(F('Full name', 'new')), row(F('Address line 1')), row(F('Town or city')), row(F('Postcode')),
      row(F('Card number')), row(F('Expiry'), F('CVC'))] },
    notes: ['Country defaults to UK; address line 2 opens on request.', 'Account creation moves to the confirmation page.', 'Name on card is dropped: check with the acquirer and fraud tools in the design review.'],
  },
  'R-FF2': {
    summary: 'Four typed address fields → postcode lookup with a manual fallback.',
    a: { title: 'A · typed address', rows: [row(F('Email')), row(F('Full name')), row(F('Address line 1', 'gone')), row(F('Address line 2', 'gone')), row(F('Town or city', 'gone')), row(F('Postcode')), row(F('Card number')), row(F('Expiry'), F('CVC'))] },
    b: { title: 'B · address lookup', rows: [row(F('Email')), row(F('Full name')), row(F('Postcode')), row(F('Find address', 'new', 'button')), row(F('Choose your address', 'new', 'select')), row(F('Enter address manually', 'new', 'link')), row(F('Card number')), row(F('Expiry'), F('CVC'))] },
    notes: ['The lookup needs an address data provider: a cost and a new dependency.', 'Manual entry must stay one tap away for addresses the lookup misses.'],
  },
  'R-FF3': {
    summary: 'The checkout as released around the onset date → the release before it.',
    release: true,
    notes: ['What differs is whatever that release changed: read it from the release log, not from this page.', 'A rollback test is only meaningful if the release log confirms a change near the onset.'],
  },
});

const MARK = { gone: 'Removed in B', new: 'New in B', moved: 'Moved after payment' };
function screen(side, which) {
  return `<figure class="phone" aria-label="${side.title}"><figcaption>${side.title}</figcaption><div class="phone-frame"><div class="phone-bar">shop.example/checkout</div><div class="phone-body">
    ${side.rows.map(r => `<div class="m-row">${r.map(f => {
      const flag = which === 'a' ? (f.mark === 'gone' || f.mark === 'moved' ? f.mark : '') : f.mark === 'new' ? 'new' : '';
      return `<span class="m-field m-${f.kind}${flag ? ' is-' + flag : ''}" ${flag ? `title="${MARK[flag]}"` : ''}>${f.kind === 'check' ? '<i></i>' : ''}${f.label}</span>`;
    }).join('')}</div>`).join('')}
    <span class="m-pay">Pay</span></div></div></figure>`;
}
const count = side => side.rows.flat().filter(f => ['input', 'check', 'select'].includes(f.kind)).length;

                                                                                           
export function treatmentMock(ruleId) {
  const t = TREATMENTS[ruleId];
  if (!t) return null;
  const notes = `<ul class="small mock-notes">${t.notes.map(n => `<li>${n}</li>`).join('')}</ul>`;
  if (t.release) return `<p class="small">${t.summary}</p><div class="grid2 mock-release"><div class="note"><b>A · current release</b><br>The checkout as it is now, after the change around the onset.</div><div class="note"><b>B · previous release</b><br>The checkout before that change, served to half of eligible checkouts.</div></div>${notes}`;
  return `<p class="small">${t.summary} <span class="muted">Inputs: A ${count(t.a)}, B ${count(t.b)}.</span></p>
    <div class="mock-pair">${screen(t.a, 'a')}${screen(t.b, 'b')}</div>
    <div class="legend mock-legend"><span><i class="k-gone"></i>Removed in B</span><span><i class="k-moved"></i>Moved after payment</span><span><i class="k-new"></i>New in B</span></div>${notes}`;
}
