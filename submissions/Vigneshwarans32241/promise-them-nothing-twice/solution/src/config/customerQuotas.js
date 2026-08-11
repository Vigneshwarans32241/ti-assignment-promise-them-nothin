/**
 * Customer Quota Configuration & Scheduled Overrides
 * Simulates database records for customer tiers and auditable exception windows.
 */

const CUSTOMER_CONFIGS = {
  // Northwind Logistics - Enterprise tier with nightly batch override
  'northwind-logistics': {
    customerId: 'northwind-logistics',
    baseRpm: 300,
    tier: 'Enterprise',
    overrides: [
      {
        id: 'ovr_northwind_nightly_batch',
        overrideRpm: 1200,
        windowStartUTC: '02:00:00',
        windowEndUTC: '04:00:00',
        isActive: true,
        expiresAt: '2026-04-30T00:00:00Z', // 6-week renewal deadline
        reason: 'P0 escalation - Nightly ERP batch exception prior to contract renewal',
        approvedBy: 'marcus.webb@relayapi.com / priya.nair@relayapi.com'
      }
    ]
  },

  // Standard Growth customer
  'acme-corp': {
    customerId: 'acme-corp',
    baseRpm: 300,
    tier: 'Growth',
    overrides: []
  },

  // Standard Starter customer
  'globex-inc': {
    customerId: 'globex-inc',
    baseRpm: 60,
    tier: 'Starter',
    overrides: []
  }
};

/**
 * Fetch customer configuration rule object
 * @param {string} customerId 
 * @returns {object|null}
 */
function getCustomerConfig(customerId) {
  return CUSTOMER_CONFIGS[customerId] || null;
}

module.exports = {
  CUSTOMER_CONFIGS,
  getCustomerConfig
};
