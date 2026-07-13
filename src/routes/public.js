'use strict';
const express = require('express');
const { getSettings } = require('../db');

const router = express.Router();

const LINKS = {
  starter: process.env.LINK_STARTER || 'https://buy.stripe.com/bJefZh0DUdo60dteSyefC05',
  pro:     process.env.LINK_PRO     || 'https://buy.stripe.com/dRm5kD2M24RAd0feSyefC06',
  elite:   process.env.LINK_ELITE   || 'https://buy.stripe.com/7sY00j0DUbfYe4j25MefC07',
  prime:   process.env.LINK_PRIME   || 'https://buy.stripe.com/REPLACE_WITH_PRIME_LINK'
};

router.get('/pricing', (req, res) => {
  const prices = getSettings().prices || {};
  res.json({
    packages: {
      starter: { label: prices.starter || '$99/mo',  link: LINKS.starter },
      pro:     { label: prices.pro     || '$179/mo', link: LINKS.pro     },
      elite:   { label: prices.elite   || '$299/mo', link: LINKS.elite   },
      prime:   { label: prices.prime   || '$2,500',  link: LINKS.prime   }
    }
  });
});

module.exports = router;
