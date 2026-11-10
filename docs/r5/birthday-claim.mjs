// A successful status alone does not prove a permanent award. The deployed
// gateway may return ALREADY_CLAIMED with claim:null after an insert conflict.
export function readBirthdayClaim(response, familyId) {
  if (response?.api !== 'r5_birthday' || response.error) return null;
  const { status, claim, newly_claimed: newlyClaimed } = response;
  if (status !== 'CLAIMED' && status !== 'ALREADY_CLAIMED') return null;
  if (newlyClaimed !== (status === 'CLAIMED')) return null;
  if (claim?.family_id !== familyId || claim?.gift_id !== 'six-star-supercar-2026'
      || claim?.permanent !== true || !Number.isFinite(Date.parse(claim.claimed_at))) return null;
  return { vehicleId: 'birthday-star-6', newlyClaimed };
}
