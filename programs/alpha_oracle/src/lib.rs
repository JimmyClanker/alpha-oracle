use anchor_lang::prelude::*;

declare_id!("BkQs8LxquVLUXHq44nQwpaenQzyZMBksrpVz2YN28MjV");

#[program]
pub mod alpha_oracle {
    use super::*;

    /// Initialize a new oracle (one-time setup)
    pub fn initialize_oracle(ctx: Context<InitializeOracle>, name: String) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        oracle.authority = ctx.accounts.authority.key();
        oracle.name = name;
        oracle.total_predictions = 0;
        oracle.wins = 0;
        oracle.losses = 0;
        oracle.created_at = Clock::get()?.unix_timestamp;
        oracle.bump = ctx.bumps.oracle;
        Ok(())
    }

    /// Create a new prediction
    pub fn create_prediction(
        ctx: Context<CreatePrediction>,
        asset: String,
        direction: Direction,
        entry_price: u64,        // Price in micro-units (6 decimals)
        take_profit: u64,
        stop_loss: u64,
        timeframe_hours: u16,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        let prediction = &mut ctx.accounts.prediction;
        let clock = Clock::get()?;

        prediction.oracle = oracle.key();
        prediction.prediction_id = oracle.total_predictions;
        prediction.asset = asset;
        prediction.direction = direction;
        prediction.entry_price = entry_price;
        prediction.take_profit = take_profit;
        prediction.stop_loss = stop_loss;
        prediction.created_at = clock.unix_timestamp;
        prediction.expires_at = clock.unix_timestamp + (timeframe_hours as i64 * 3600);
        prediction.status = PredictionStatus::Active;
        prediction.result_price = 0;
        prediction.verified_at = 0;
        prediction.bump = ctx.bumps.prediction;

        oracle.total_predictions += 1;

        emit!(PredictionCreated {
            oracle: oracle.key(),
            prediction_id: prediction.prediction_id,
            asset: prediction.asset.clone(),
            direction: prediction.direction.clone(),
            entry_price,
            take_profit,
            stop_loss,
            expires_at: prediction.expires_at,
        });

        Ok(())
    }

    /// Verify a prediction result (can be called by anyone after expiry)
    pub fn verify_prediction(
        ctx: Context<VerifyPrediction>,
        result_price: u64,
    ) -> Result<()> {
        let oracle = &mut ctx.accounts.oracle;
        let prediction = &mut ctx.accounts.prediction;
        let clock = Clock::get()?;

        require!(
            prediction.status == PredictionStatus::Active,
            AlphaOracleError::PredictionNotActive
        );
        require!(
            clock.unix_timestamp >= prediction.expires_at,
            AlphaOracleError::PredictionNotExpired
        );

        prediction.result_price = result_price;
        prediction.verified_at = clock.unix_timestamp;

        // Determine win/loss based on direction and price movement
        let is_win = match prediction.direction {
            Direction::Long => {
                // Win if price >= take_profit OR (price > entry AND not hit stop_loss)
                result_price >= prediction.take_profit
                    || (result_price > prediction.entry_price && result_price > prediction.stop_loss)
            }
            Direction::Short => {
                // Win if price <= take_profit OR (price < entry AND not hit stop_loss)
                result_price <= prediction.take_profit
                    || (result_price < prediction.entry_price && result_price < prediction.stop_loss)
            }
        };

        if is_win {
            prediction.status = PredictionStatus::Won;
            oracle.wins += 1;
        } else {
            prediction.status = PredictionStatus::Lost;
            oracle.losses += 1;
        }

        emit!(PredictionVerified {
            oracle: oracle.key(),
            prediction_id: prediction.prediction_id,
            result_price,
            status: prediction.status.clone(),
        });

        Ok(())
    }
}

// === ACCOUNTS ===

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Oracle::INIT_SPACE,
        seeds = [b"oracle", authority.key().as_ref()],
        bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePrediction<'info> {
    #[account(
        mut,
        seeds = [b"oracle", authority.key().as_ref()],
        bump = oracle.bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        init,
        payer = authority,
        space = 8 + Prediction::INIT_SPACE,
        seeds = [b"prediction", oracle.key().as_ref(), &oracle.total_predictions.to_le_bytes()],
        bump
    )]
    pub prediction: Account<'info, Prediction>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyPrediction<'info> {
    #[account(
        mut,
        seeds = [b"oracle", oracle.authority.as_ref()],
        bump = oracle.bump
    )]
    pub oracle: Account<'info, Oracle>,
    #[account(
        mut,
        seeds = [b"prediction", oracle.key().as_ref(), &prediction.prediction_id.to_le_bytes()],
        bump = prediction.bump,
        constraint = prediction.oracle == oracle.key()
    )]
    pub prediction: Account<'info, Prediction>,
    pub verifier: Signer<'info>,
}

// === STATE ===

#[account]
#[derive(InitSpace)]
pub struct Oracle {
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub total_predictions: u64,
    pub wins: u64,
    pub losses: u64,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Prediction {
    pub oracle: Pubkey,
    pub prediction_id: u64,
    #[max_len(16)]
    pub asset: String,
    pub direction: Direction,
    pub entry_price: u64,
    pub take_profit: u64,
    pub stop_loss: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub status: PredictionStatus,
    pub result_price: u64,
    pub verified_at: i64,
    pub bump: u8,
}

// === TYPES ===

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum Direction {
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum PredictionStatus {
    Active,
    Won,
    Lost,
    Expired,
}

// === EVENTS ===

#[event]
pub struct PredictionCreated {
    pub oracle: Pubkey,
    pub prediction_id: u64,
    pub asset: String,
    pub direction: Direction,
    pub entry_price: u64,
    pub take_profit: u64,
    pub stop_loss: u64,
    pub expires_at: i64,
}

#[event]
pub struct PredictionVerified {
    pub oracle: Pubkey,
    pub prediction_id: u64,
    pub result_price: u64,
    pub status: PredictionStatus,
}

// === ERRORS ===

#[error_code]
pub enum AlphaOracleError {
    #[msg("Prediction is not active")]
    PredictionNotActive,
    #[msg("Prediction has not expired yet")]
    PredictionNotExpired,
}
