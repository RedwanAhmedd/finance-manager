# Treasury integration plan

Finance Manager reads Canadian cash from RentStream-owned `treasury_accounts` snapshots. Operational rental bank accounts remain in the existing BDT bank subsystem; cross-border treasury balances stay separate so RentStream never adds CAD and BDT amounts together without an explicit FX step.
