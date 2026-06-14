use anchor_lang::prelude::*;

use crate::state::MessagingKey;

/// Publish (or update) the caller's x25519 messaging public key so others can
/// encrypt private messages to them. The key is derived client-side from a
/// wallet signature; only the public half is stored.
pub fn register_messaging_key(ctx: Context<RegisterMessagingKey>, box_pubkey: [u8; 32]) -> Result<()> {
    let k = &mut ctx.accounts.key;
    k.owner = ctx.accounts.owner.key();
    k.box_pubkey = box_pubkey;
    k.bump = ctx.bumps.key;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterMessagingKey<'info> {
    #[account(
        init_if_needed,
        payer = owner,
        space = MessagingKey::SPACE,
        seeds = [b"msgkey", owner.key().as_ref()],
        bump
    )]
    pub key: Account<'info, MessagingKey>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}
