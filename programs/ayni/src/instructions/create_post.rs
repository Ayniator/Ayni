use anchor_lang::prelude::*;

use crate::errors::AyniError;
use crate::state::{Circle, Membership, Post};

/// A member publishes a post/bulletin (text and/or an IPFS image), visible only
/// within [start_date, end_date]. "Member" is proven by passing a live
/// Membership in this Circle whose `owner == author` (a wallet-bound membership).
/// Any Council seat can later delete it via `delete_post`.
pub fn create_post(
    ctx: Context<CreatePost>,
    nonce: u64,
    text: String,
    image_cid: String,
    start_date: i64,
    end_date: i64,
) -> Result<()> {
    require!(text.len() <= Post::MAX_TEXT, AyniError::NameTooLong);
    require!(image_cid.len() <= Post::MAX_CID, AyniError::ProfileFieldTooLong);
    require!(end_date > start_date, AyniError::InvalidCoordinate);
    require!(!(text.is_empty() && image_cid.is_empty()), AyniError::WrongProposalAction);

    let now = Clock::get()?.unix_timestamp;
    let membership = &ctx.accounts.membership;
    // The signer must own a live membership in THIS Circle.
    require!(membership.circle == ctx.accounts.circle.key(), AyniError::Unauthorized);
    require!(membership.owner == ctx.accounts.author.key(), AyniError::Unauthorized);
    require!(membership.expires_at > now, AyniError::MembershipExpired);

    let post = &mut ctx.accounts.post;
    post.circle = ctx.accounts.circle.key();
    post.author = ctx.accounts.author.key();
    post.nonce = nonce;
    post.created_at = now;
    post.start_date = start_date;
    post.end_date = end_date;
    post.image_cid = image_cid;
    post.text = text;
    post.bump = ctx.bumps.post;
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreatePost<'info> {
    pub circle: Account<'info, Circle>,

    /// The author's membership in this Circle — proves membership and ties the
    /// post to a wallet-bound member (anonymous, owner-less memberships cannot
    /// post; a Council seat can post via its own membership if it holds one).
    #[account(has_one = circle)]
    pub membership: Account<'info, Membership>,

    #[account(
        init,
        payer = author,
        space = Post::SPACE,
        seeds = [b"post", circle.key().as_ref(), author.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub post: Account<'info, Post>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}
