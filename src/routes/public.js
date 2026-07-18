'use strict';
const express = require('express');
const { getSettings } = require('../db');

const router = express.Router();

const LINKS = {
  access:  process.env.LINK_ACCESS  || 'https://buy.stripe.com/5kQaEX3Q697Q4tJbGmefC0b',
  starter: process.env.LINK_STARTER || 'https://buy.stripe.com/bJefZh0DUdo60dteSyefC05',
  pro:     process.env.LINK_PRO     || 'https://buy.stripe.com/dRm5kD2M24RAd0feSyefC06',
  elite:   process.env.LINK_ELITE   || 'https://buy.stripe.com/7sY00j0DUbfYe4j25MefC07',
  prime:   process.env.LINK_PRIME   || 'https://buy.stripe.com/cNi8wPaeu2Js2lB5hYefC09'
};

router.get('/pricing', (req, res) => {
  const prices = getSettings().prices || {};
  res.json({
    packages: {
      access:  { label: prices.access  || '$45/mo', link: LINKS.access  },
      starter: { label: prices.starter || '$500',   link: LINKS.starter },
      pro:     { label: prices.pro     || '$1000',  link: LINKS.pro     },
      elite:   { label: prices.elite   || '$1500',  link: LINKS.elite   },
      prime:   { label: prices.prime   || '$2500',  link: LINKS.prime   }
    }
  });
});

module.exports = router;
