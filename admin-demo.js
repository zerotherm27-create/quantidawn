/* Sample data for previewing the dashboard before a Supabase project is connected.
   Only used when config.js has no project URL. Everything here is invented. */
(function () {
  'use strict';

  function rng(seed) {                       // small deterministic PRNG so the preview is stable
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var FIRST = ['Mitchell', 'Priya', 'Tomasz', 'Hannah', 'Wei Jie', 'Marcus', 'Aroha', 'Rafael', 'Deepika', 'Colton',
    'Siti', 'Jamal', 'Brenna', 'Kenji', 'Odalys', 'Fergus', 'Nadia', 'Lucas', 'Imogen', 'Arjun', 'Beatriz', 'Callum',
    'Yasmin', 'Declan', 'Mei Ling', 'Tobias', 'Ngaire', 'Gareth', 'Ravi', 'Sloane'];
  var LAST = ['Kowalczyk', 'Nair', 'Whitfield', 'Tan', 'Okafor', 'Ferreira', 'Lindqvist', 'Rahman', 'Castellanos',
    'Abernathy', 'Haddad', 'Pemberton', 'Sato', 'Delacroix', 'Mahlangu', 'Brennan', 'Iyer', 'Kessler', 'Moana',
    'Vasquez', 'Holloway', 'Chua', 'Reinholt', 'Dunmore', 'Sandhu'];
  var COMPANY = ['Northgate Builders', 'Ridgeline Civil', 'Kestrel Fitouts', 'Harbourview Constructions',
    'Bluestone Homes', 'Alder & Finch Carpentry', 'Summit Roofing Co', 'Ironbark Earthworks', 'Marlow Plumbing',
    'Cedarline Developments', 'Tidewater Concrete', 'Pinecrest Framing', 'Orion Interiors', 'Granite Peak Builders',
    'Lowden Drywall', 'Meridian Projects', 'Copperfield Electrical', 'Stonebridge Contracting', 'Redgum Renovations',
    'Falcon Site Services', 'Anchorage Builders', 'Verity Construction', 'Bayside Extensions', 'Crestwood Civil'];
  var DESC = {
    residential: [
      'Two-storey dwelling, DA drawings attached. Need a full trade-by-trade breakdown for tender.',
      'Kitchen and bathroom renovation on a 1960s brick house. Scope notes and photos to follow.',
      'Dual occupancy on a sloping block. Structural and architectural sets are attached.',
      'Granny flat and garage. Looking for a quick takeoff to price against two quotes we already have.'
    ],
    commercial: [
      'Retail fit-out, about 2,400 sq ft. Drawings and finishes schedule attached.',
      'Office refurbishment across two floors, including partitions, ceilings and services.',
      'Medical clinic fit-out with plumbing-heavy scope. Need a full BOQ with margin.',
      'Warehouse tenancy conversion. Bid due in nine days.'
    ],
    civil: [
      'Subdivision roads and drainage, roughly 600 m of new road. Quantities for earthworks and pavements.',
      'Site services and stormwater for a light-industrial estate. Long-section drawings attached.',
      'Retaining walls and bulk earthworks for a hillside development.'
    ],
    subcontractor: [
      'Drywall package for a four-storey apartment building. Need trade-specific quantities only.',
      'Roofing takeoff for a warehouse. Metal deck and insulation.',
      'Framing package for 12 townhouses. Timber schedule required.'
    ]
  };
  var NOTES = [
    'Called back, prefers email. Wants price before Friday.',
    'Sent a follow-up with the retainer options.',
    'Repeat client. Previous estimate was on time.',
    'Needs revised drawings before we can price.',
    'Waiting on their tender deadline.'
  ];
  var CUR = { AU: 'AUD', US: 'USD', SG: 'SGD', Other: 'USD' };

  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  function weighted(r, pairs) {
    var total = pairs.reduce(function (s, p) { return s + p[1]; }, 0), x = r() * total;
    for (var i = 0; i < pairs.length; i++) { x -= pairs[i][1]; if (x <= 0) return pairs[i][0]; }
    return pairs[0][0];
  }
  function uuid(r) {
    var h = '';
    for (var i = 0; i < 32; i++) h += Math.floor(r() * 16).toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20);
  }

  window.QUANTIDAWN_DEMO = function () {
    var r = rng(20260924), now = Date.now(), rows = [], DAY = 86400000;
    var total = 92;

    for (var i = 0; i < total; i++) {
      // more recent inquiries are more common (a growing pipeline), and weekdays are busier
      var ageDays = Math.pow(r(), 1.55) * 150;
      var created = new Date(now - ageDays * DAY);
      if ([0, 6].indexOf(created.getDay()) !== -1 && r() < 0.55) created = new Date(created.getTime() + 2 * DAY);
      if (created.getTime() > now - 20 * 60000) created = new Date(now - (20 + Math.floor(r() * 400)) * 60000);
      created.setHours(6 + Math.floor(r() * 16), Math.floor(r() * 60), Math.floor(r() * 60));
      if (created.getTime() > now) created = new Date(now - 45 * 60000);

      var first = pick(r, FIRST), last = pick(r, LAST), company = pick(r, COMPANY);
      var market = weighted(r, [['AU', 52], ['US', 28], ['SG', 12], ['Other', 8]]);
      var type = weighted(r, [['residential', 42], ['commercial', 30], ['civil', 14], ['subcontractor', 14]]);
      var interest = r() < 0.3 ? 'retainer' : 'single';
      var age = (now - created.getTime()) / DAY;

      var status;
      if (age < 1.2) status = 'new';
      else if (age < 5) status = weighted(r, [['new', 3], ['contacted', 5], ['quoted', 4]]);
      else status = weighted(r, [['contacted', 7], ['quoted', 12], ['won', 22], ['lost', 27], ['spam', 5]]);

      var row = {
        id: uuid(r),
        created_at: created.toISOString(),
        name: first + ' ' + last,
        company: company,
        email: (first.split(' ')[0] + '.' + last).toLowerCase().replace(/[^a-z.]/g, '') + '@' + company.toLowerCase().replace(/[^a-z]/g, '') + '.com',
        phone: r() < 0.7 ? (market === 'AU' ? '+61 4' + Math.floor(10000000 + r() * 89999999) : market === 'US' ? '+1 (' + (200 + Math.floor(r() * 700)) + ') ' + Math.floor(200 + r() * 700) + '-' + Math.floor(1000 + r() * 8999) : '+65 9' + Math.floor(1000000 + r() * 8999999)) : null,
        market: market,
        project_type: type,
        interest: interest,
        timing: r() < 0.7 ? pick(r, ['asap', 'week', 'flexible']) : null,
        description: status === 'spam' ? 'Buy cheap followers and SEO packages today!!! Visit our website for a special offer.' : pick(r, DESC[type]),
        files: status === 'spam' || r() < 0.22 ? [] : [0, 1, 2].slice(0, 1 + Math.floor(r() * 3)).map(function (n) { return 'demo/' + n + '-' + pick(r, ['site-plan.pdf', 'floor-plans.pdf', 'structural.dwg', 'elevations.pdf', 'scope-notes.jpg']); }),
        status: status,
        notes: null,
        first_response_at: null,
        follow_up_on: null,
        quote_value: null,
        quote_currency: null,
        updated_at: created.toISOString()
      };

      if (status !== 'new' && status !== 'spam') {
        var hours = r() < 0.7 ? 0.4 + r() * 6 : 6 + r() * 30;
        row.first_response_at = new Date(created.getTime() + hours * 3600000).toISOString();
        row.updated_at = row.first_response_at;
      }
      if (status === 'quoted' || status === 'won' || (status === 'lost' && r() < 0.6)) {
        var base = interest === 'retainer' ? [800, 1500, 2500][Math.floor(r() * 3)]
          : { residential: 300 + r() * 1200, commercial: 700 + r() * 1800, civil: 900 + r() * 2200, subcontractor: 300 + r() * 900 }[type];
        row.quote_value = Math.round(base / 10) * 10;
        row.quote_currency = CUR[market];
      }
      if (status === 'contacted' || status === 'quoted') {
        var offset = Math.floor(r() * 9) - 3;                       // some overdue, some upcoming
        row.follow_up_on = new Date(now + offset * DAY).toISOString().slice(0, 10);
      }
      if (row.first_response_at && r() < 0.28) row.notes = pick(r, NOTES);
      rows.push(row);
    }

    // make sure the preview shows the "needs attention" flags
    var stale = rows.filter(function (x) { return x.status === 'new'; });
    stale.slice(0, 2).forEach(function (x, i) {
      x.created_at = new Date(now - (30 + i * 19) * 3600000).toISOString();
      x.updated_at = x.created_at;
    });
    rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    return rows;
  };
})();
