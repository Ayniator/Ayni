use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_2022::spl_token_2022::extension::ExtensionType;
use anchor_spl::token_2022::spl_token_2022::state::Mint as MintState;
use anchor_spl::token_2022::{initialize_mint2, InitializeMint2, Token2022};
use anchor_spl::token_2022_extensions::{non_transferable_mint_initialize, NonTransferableMintInitialize};

use crate::council::SEAT_TREASURER;
use crate::errors::AyniError;
use crate::state::Circle;

/// Create the Circle's soulbound (Token-2022 **NonTransferable**) membership mint
/// in one instruction and register it on the Circle — no out-of-band setup step
/// (finishes F3). Mint authority = the Circle PDA (so `mint_membership_token` can
/// mint), decimals = 0, no freeze authority. Gated to the **Treasurer** seat
/// (assets are the Treasurer's domain). The token is non-transferable, so it can
/// never be sold or moved; anonymity is preserved because the membership record
/// is keyed by a ZK commitment, not by this token.
pub fn create_membership_mint(ctx: Context<CreateMembershipMint>) -> Result<()> {
    // Treasurer-gated.
    ctx.accounts
        .circle
        .council
        .require_seat(&ctx.accounts.treasurer.key(), SEAT_TREASURER)?;
    let circle_key = ctx.accounts.circle.key();

    // 1) Allocate the mint account sized for the NonTransferable extension,
    //    owned by the Token-2022 program.
    let space = ExtensionType::try_calculate_account_len::<MintState>(&[ExtensionType::NonTransferable])
        .map_err(|_| error!(AyniError::MintInitFailed))?;
    let lamports = Rent::get()?.minimum_balance(space);
    create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        lamports,
        space as u64,
        &ctx.accounts.token_program.key(),
    )?;

    // 2) Initialize the NonTransferable extension — MUST precede initialize_mint2.
    non_transferable_mint_initialize(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        NonTransferableMintInitialize {
            token_program_id: ctx.accounts.token_program.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
        },
    ))?;

    // 3) Initialize the mint: authority = Circle PDA, 0 decimals, no freeze.
    initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            InitializeMint2 { mint: ctx.accounts.mint.to_account_info() },
        ),
        0,
        &circle_key,
        None,
    )?;

    // 4) Register it on the Circle.
    ctx.accounts.circle.membership_mint = ctx.accounts.mint.key();
    Ok(())
}

#[derive(Accounts)]
pub struct CreateMembershipMint<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    /// The new mint — a fresh keypair the client generates and co-signs. Created
    /// and initialized here as a Token-2022 NonTransferable mint.
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Must be the Council's Treasurer seat (authorizes the mint).
    pub treasurer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
