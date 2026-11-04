// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title LedgerCoin (LDG)
/// @notice An ERC-20 token with a maximum supply, an emergency pause and roles:
/// minters create tokens, pausers can freeze all transfers, and the admin
/// hands out roles.
contract LedgerCoin is
    ERC20,
    ERC20Burnable,
    ERC20Capped,
    ERC20Pausable,
    AccessControl
{
    /// @notice Accounts allowed to create new tokens
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Accounts allowed to pause and resume all transfers
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @param admin Gets every role at deployment, and can give roles to others.
    /// @param maxSupply The maximum number of tokens that can ever exist
    /// (with 18 decimals).
    constructor(address admin, uint256 maxSupply)
        ERC20("LedgerCoin", "LDG")
        ERC20Capped(maxSupply)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @notice Create `amount` new tokens and give them to `to`. Minters only.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Emergency stop: blocks every transfer, mint and burn. Pausers only.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Lift the emergency stop. Pausers only.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @dev Required by Solidity: ERC20, ERC20Capped and ERC20Pausable all
    /// define _update, so we must specify the override. super._update runs all
    /// of them: the pause check, the cap check, then the balance update.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Capped, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}