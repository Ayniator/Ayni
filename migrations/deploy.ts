// Anchor migration script — invoked by `anchor migrate`, injected with a
// provider configured from Anchor.toml. Add bootstrap steps here, e.g. creating
// the AHA World Service Circle that all Circles fork under.
const anchor = require("@coral-xyz/anchor");

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);
  // TODO(ayni): bootstrap the World Service Circle root authority + lineage root.
};
