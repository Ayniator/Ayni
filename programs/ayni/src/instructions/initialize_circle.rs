use anchor_lang::prelude::*;

use crate::council::{Council, COUNCIL_SEATS};
use crate::errors::AyniError;
use crate::state::Circle;

/// Create a Circle and seat its 7-seat Council at once — the Council IS the
/// authority, so there is no admin key. `parent` is the Circle this one nests
/// under (the World Service Circle's address, or a chosen root for the
/// foundation) and is a PDA seed. Creation is permissionless: whoever submits
/// the tx is only a fee-payer; governance is the seated Council from here on.
pub fn initialize_circle(
    ctx: Context<InitializeCircle>,
    _parent: Pubkey,
    name: String,
    membership_period: i64,
    recovery_timelock: i64,
    seats: [Pubkey; COUNCIL_SEATS],
) -> Result<()> {
    require!(name.len() <= Circle::MAX_NAME, AyniError::NameTooLong);

    // Every seat must be filled and distinct (one holder per seat).
    for i in 0..COUNCIL_SEATS {
        require!(seats[i] != Pubkey::default(), AyniError::InvalidSeatIndex);
        for j in (i + 1)..COUNCIL_SEATS {
            require!(seats[i] != seats[j], AyniError::DuplicateSeat);
        }
    }

    let circle = &mut ctx.accounts.circle;
    circle.parent = ctx.accounts.parent.key();
    circle.council = Council::empty();
    circle.council.seats = seats;
    circle.council.recovery_timelock = recovery_timelock;
    circle.membership_period = membership_period;
    circle.member_count = 0;
    // Sybil gate off by default; enable + set the unique-human root via
    // `set_personhood` (Secretary) once a personhood source is chosen.
    circle.require_personhood = false;
    circle.personhood_root = [0u8; 32];
    circle.membership_mint = Pubkey::default();
    circle.name = name;
    circle.bump = ctx.bumps.circle;
    Ok(())
}

#[derive(Accounts)]
#[instruction(parent: Pubkey, name: String)]
pub struct InitializeCircle<'info> {
    #[account(
        init,
        payer = payer,
        space = Circle::SPACE,
        seeds = [b"circle", parent.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub circle: Account<'info, Circle>,

    /// CHECK: the parent Circle (or root) this Circle nests under — a seed only.
    pub parent: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}
