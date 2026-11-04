import { expect } from "chai";
import { network } from "hardhat";

// Start a fresh simulated blockchain for these tests
const { ethers } = await network.create();

// Helper: "100" -> 100 LDG written with 18 decimals
const ldg = (amount: string) => ethers.parseUnits(amount, 18);

describe("LedgerCoin", function () {
    const MAX_SUPPLY = ldg("1000000"); // 1 million LDG

    // Deploy a brand-new token before each test, with 3 test accounts
    async function deploy() {
        const [admin, alice, bob] = await ethers.getSigners();

        const token = await ethers.deployContract("LedgerCoin", [
            admin.address,
            MAX_SUPPLY,
        ]);

        const MINTER_ROLE = await token.MINTER_ROLE();
        const PAUSER_ROLE = await token.PAUSER_ROLE();
        const ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();

        return {
            token,
            admin,
            alice,
            bob,
            MINTER_ROLE,
            PAUSER_ROLE,
            ADMIN_ROLE,
        };
    }

    describe("Deployment", function () {
        it("has the right name, symbol, decimals, cap and roles", async function () {
            const {
                token,
                admin,
                alice,
                MINTER_ROLE,
                PAUSER_ROLE,
                ADMIN_ROLE,
            } = await deploy();

            expect(await token.name()).to.equal("LedgerCoin");
            expect(await token.symbol()).to.equal("LDG");
            expect(await token.decimals()).to.equal(18n);
            expect(await token.cap()).to.equal(MAX_SUPPLY);
            expect(await token.totalSupply()).to.equal(0n);

            // The admin gets every role, nobody else gets any
            expect(await token.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
            expect(await token.hasRole(MINTER_ROLE, admin.address)).to.equal(true);
            expect(await token.hasRole(PAUSER_ROLE, admin.address)).to.equal(true);
            expect(await token.hasRole(MINTER_ROLE, alice.address)).to.equal(false);
        });
    });

    describe("Minting", function () {
        it("lets a minter mint tokens", async function () {
            const { token, alice } = await deploy();

            await expect(token.mint(alice.address, ldg("500")))
                .to.emit(token, "Transfer")
                .withArgs(ethers.ZeroAddress, alice.address, ldg("500"));

            expect(await token.balanceOf(alice.address)).to.equal(ldg("500"));
            expect(await token.totalSupply()).to.equal(ldg("500"));
        });

        it("refuses minting by someone without the minter role", async function () {
            const { token, alice, MINTER_ROLE } = await deploy();

            await expect(
                token.connect(alice).mint(alice.address, ldg("1")),
            )
                .to.be.revertedWithCustomError(
                    token,
                    "AccessControlUnauthorizedAccount",
                )
                .withArgs(alice.address, MINTER_ROLE);
        });

        it("refuses minting above the maximum supply", async function () {
            const { token, alice } = await deploy();

            await token.mint(alice.address, MAX_SUPPLY);

            await expect(
                token.mint(alice.address, 1n),
            ).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
        });
    });

    describe("Transfers", function () {
        it("moves tokens between users and emits Transfer", async function () {
            const { token, alice, bob } = await deploy();

            await token.mint(alice.address, ldg("100"));

            await expect(
                token.connect(alice).transfer(bob.address, ldg("30")),
            )
                .to.emit(token, "Transfer")
                .withArgs(alice.address, bob.address, ldg("30"));

            expect(await token.balanceOf(alice.address)).to.equal(ldg("70"));
            expect(await token.balanceOf(bob.address)).to.equal(ldg("30"));
        });

        it("refuses sending more than your balance", async function () {
            const { token, alice, bob } = await deploy();

            await token.mint(alice.address, ldg("10"));

            await expect(
                token.connect(alice).transfer(bob.address, ldg("11")),
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });
    });

    describe("Allowances (approve + transferFrom)", function () {
        it("lets an approved spender move tokens and lowers the allowance", async function () {
            const { token, admin, alice, bob } = await deploy();

            await token.mint(alice.address, ldg("100"));

            // Alice allows Bob to spend 40 of her LDG
            await expect(
                token.connect(alice).approve(bob.address, ldg("40")),
            )
                .to.emit(token, "Approval")
                .withArgs(alice.address, bob.address, ldg("40"));

            // Bob sends 25 of Alice's LDG to the admin account
            await token
                .connect(bob)
                .transferFrom(alice.address, admin.address, ldg("25"));

            expect(await token.balanceOf(alice.address)).to.equal(ldg("75"));
            expect(await token.balanceOf(admin.address)).to.equal(ldg("25"));
            expect(await token.allowance(alice.address, bob.address)).to.equal(
                ldg("15"),
            );
        });

        it("refuses spending more than the allowance", async function () {
            const { token, admin, alice, bob } = await deploy();

            await token.mint(alice.address, ldg("100"));
            await token.connect(alice).approve(bob.address, ldg("10"));

            await expect(
                token
                    .connect(bob)
                    .transferFrom(alice.address, admin.address, ldg("11")),
            ).to.be.revertedWithCustomError(
                token,
                "ERC20InsufficientAllowance",
            );
        });
    });

    describe("Burning", function () {
        it("lets a holder destroy their own tokens", async function () {
            const { token, alice } = await deploy();

            await token.mint(alice.address, ldg("50"));
            await token.connect(alice).burn(ldg("20"));

            expect(await token.balanceOf(alice.address)).to.equal(ldg("30"));
            expect(await token.totalSupply()).to.equal(ldg("30"));
        });
    });

    describe("Emergency pause", function () {
        it("blocks transfers while paused, and allows them again after unpause", async function () {
            const { token, admin, alice, bob } = await deploy();

            await token.mint(alice.address, ldg("100"));

            await expect(token.pause())
                .to.emit(token, "Paused")
                .withArgs(admin.address);

            expect(await token.paused()).to.equal(true);

            await expect(
                token.connect(alice).transfer(bob.address, ldg("10")),
            ).to.be.revertedWithCustomError(token, "EnforcedPause");

            await expect(token.unpause())
                .to.emit(token, "Unpaused")
                .withArgs(admin.address);

            await token.connect(alice).transfer(bob.address, ldg("10"));

            expect(await token.balanceOf(bob.address)).to.equal(ldg("10"));
        });

        it("also blocks minting and burning while paused", async function () {
            const { token, alice } = await deploy();

            await token.mint(alice.address, ldg("100"));
            await token.pause();

            await expect(
                token.mint(alice.address, ldg("1")),
            ).to.be.revertedWithCustomError(token, "EnforcedPause");

            await expect(
                token.connect(alice).burn(ldg("1")),
            ).to.be.revertedWithCustomError(token, "EnforcedPause");
        });

        it("refuses pausing by someone without the pauser role", async function () {
            const { token, alice, PAUSER_ROLE } = await deploy();

            await expect(token.connect(alice).pause())
                .to.be.revertedWithCustomError(
                    token,
                    "AccessControlUnauthorizedAccount",
                )
                .withArgs(alice.address, PAUSER_ROLE);
        });
    });

    describe("Roles", function () {
        it("lets the admin give and take back the minter role", async function () {
            const { token, admin, alice, MINTER_ROLE } = await deploy();

            await expect(token.grantRole(MINTER_ROLE, alice.address))
                .to.emit(token, "RoleGranted")
                .withArgs(MINTER_ROLE, alice.address, admin.address);

            await token.connect(alice).mint(alice.address, ldg("5")); // now allowed

            expect(await token.balanceOf(alice.address)).to.equal(ldg("5"));

            await token.revokeRole(MINTER_ROLE, alice.address);

            await expect(
                token.connect(alice).mint(alice.address, ldg("5")),
            ).to.be.revertedWithCustomError(
                token,
                "AccessControlUnauthorizedAccount",
            );
        });

        it("refuses role changes by someone who is not the admin", async function () {
            const { token, alice, bob, MINTER_ROLE, ADMIN_ROLE } = await deploy();

            await expect(
                token.connect(alice).grantRole(MINTER_ROLE, bob.address),
            )
                .to.be.revertedWithCustomError(
                    token,
                    "AccessControlUnauthorizedAccount",
                )
                .withArgs(alice.address, ADMIN_ROLE);
        });
    });
});