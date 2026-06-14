use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Message;

/// Store an end-to-end encrypted 1:1 message to `recipient` (any wallet). The
/// program never sees plaintext: `ciphertext` is a NaCl box openable only by the
/// recipient with `sender_box` + `nonce`. `expires_at` (0 = never) lets clients
/// hide it and anyone close it afterwards.
pub fn send_message(
    ctx: Context<SendMessage>,
    id: u64,
    recipient: Pubkey,
    sender_box: [u8; 32],
    nonce: [u8; 24],
    expires_at: i64,
    ciphertext: Vec<u8>,
) -> Result<()> {
    require!(ciphertext.len() <= Message::MAX_CT, AyniError::ProfileFieldTooLong);
    require!(recipient != Pubkey::default(), AyniError::WalletMismatch);

    let now = Clock::get()?.unix_timestamp;
    let m = &mut ctx.accounts.message;
    m.sender = ctx.accounts.sender.key();
    m.recipient = recipient;
    m.sender_box = sender_box;
    m.nonce = nonce;
    m.id = id;
    m.created_at = now;
    m.expires_at = expires_at;
    m.ciphertext = ciphertext;
    m.bump = ctx.bumps.message;
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64, recipient: Pubkey)]
pub struct SendMessage<'info> {
    #[account(
        init,
        payer = sender,
        space = Message::SPACE,
        seeds = [b"msg", recipient.as_ref(), sender.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub message: Account<'info, Message>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
}
