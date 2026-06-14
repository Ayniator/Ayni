use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::Message;

/// Store an end-to-end encrypted, SEALED-SENDER 1:1 message to `recipient` (any
/// wallet). The program never sees plaintext and never records who sent it:
/// `ciphertext` is a NaCl box openable only by the recipient with the single-use
/// `eph_pubkey` + `nonce`, and the sender names+signs themselves *inside* the
/// sealed payload. `ciphertext` must be exactly `CT_LEN` (the client pads every
/// message to a constant length so none leaks its size). `expires_at`
/// (0 = never) lets clients hide it and anyone close it afterwards.
pub fn send_message(
    ctx: Context<SendMessage>,
    id: u64,
    recipient: Pubkey,
    eph_pubkey: [u8; 32],
    nonce: [u8; 24],
    expires_at: i64,
    ciphertext: Vec<u8>,
) -> Result<()> {
    require!(ciphertext.len() == Message::CT_LEN, AyniError::ProfileFieldTooLong);
    require!(recipient != Pubkey::default(), AyniError::WalletMismatch);

    let now = Clock::get()?.unix_timestamp;
    let m = &mut ctx.accounts.message;
    m.recipient = recipient;
    m.eph_pubkey = eph_pubkey;
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
    // Sender is NOT part of the seed (sealed sender) — `id` is a random u64, so
    // collisions are negligible without leaking who sent it.
    #[account(
        init,
        payer = payer,
        space = Message::SPACE,
        seeds = [b"msg", recipient.as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub message: Account<'info, Message>,

    /// Pays rent + signs the tx. Their key is NOT stored on the message; note
    /// the fee-payer is still observable in the transaction itself.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
