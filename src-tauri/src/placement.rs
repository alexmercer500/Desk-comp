// Where a speech-bubble card goes beside the character in the corner: never
// over the character itself.
//
// The card goes beside the character's body (the box the page reports for
// clicks, which follows Rui and Dogesh as they move), on the side with more
// room, level with the upper body, a small gap away. If neither side has room
// it goes above, then below. Only if nothing fits (a display smaller than the
// card) does it fall back to whichever spot overlaps least.
//
// Everything here is in one unit (physical px); desktop.rs converts.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn right(&self) -> f64 {
        self.x + self.w
    }
    pub fn bottom(&self) -> f64 {
        self.y + self.h
    }
    fn overlap(&self, o: &Rect) -> f64 {
        let w = (self.right().min(o.right()) - self.x.max(o.x)).max(0.0);
        let h = (self.bottom().min(o.bottom()) - self.y.max(o.y)).max(0.0);
        w * h
    }
    fn inside(&self, o: &Rect) -> bool {
        self.x >= o.x - 0.5 && self.y >= o.y - 0.5 && self.right() <= o.right() + 0.5 && self.bottom() <= o.bottom() + 0.5
    }
}

/// Which edge of the card its tail sticks out of (so it points at the character).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tail {
    Left,
    Right,
    Top,
    Bottom,
}

impl Tail {
    pub fn from_name(name: &str) -> Option<Tail> {
        [Tail::Left, Tail::Right, Tail::Top, Tail::Bottom].into_iter().find(|t| t.name() == name)
    }

    pub fn name(self) -> &'static str {
        match self {
            Tail::Left => "left",
            Tail::Right => "right",
            Tail::Top => "top",
            Tail::Bottom => "bottom",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub card: Rect,
    pub tail: Tail,
    /// How far along its edge the tail sits, from the card's left (top/bottom
    /// tails) or top (left/right tails).
    pub tail_at: f64,
}

/// Places a `w` × `h` card next to `body`, on `area` (the display's work area),
/// `gap` away from the body. `inset` keeps the tail's tip clear of the card's
/// rounded corners. `keep`: the side it's on now, kept while it still fits (a
/// card following him as he moves doesn't jump to his other side).
pub fn place_card(body: Rect, w: f64, h: f64, area: Rect, gap: f64, inset: f64, keep: Option<Tail>) -> Placed {
    // Level with his upper body: that's where his face is.
    let aim_y = body.y + body.h * 0.3;
    let aim_x = body.x + body.w * 0.5;
    let clamp_x = |x: f64| x.clamp(area.x, (area.right() - w).max(area.x));
    let clamp_y = |y: f64| y.clamp(area.y, (area.bottom() - h).max(area.y));

    let beside = |right: bool| {
        let x = if right { body.right() + gap } else { body.x - gap - w };
        let y = clamp_y(aim_y - h * 0.4);
        let tail_at = (aim_y - y).clamp(inset, (h - inset).max(inset));
        Placed { card: Rect { x, y, w, h }, tail: if right { Tail::Left } else { Tail::Right }, tail_at }
    };
    let over = |above: bool| {
        let x = clamp_x(aim_x - w * 0.5);
        let y = if above { body.y - gap - h } else { body.bottom() + gap };
        let tail_at = (aim_x - x).clamp(inset, (w - inset).max(inset));
        Placed { card: Rect { x, y, w, h }, tail: if above { Tail::Bottom } else { Tail::Top }, tail_at }
    };

    let room_right = area.right() - body.right();
    let room_left = body.x - area.x;
    let first_right = room_right >= room_left;
    let mut candidates = [beside(first_right), beside(!first_right), over(true), over(false)];
    if let Some(i) = candidates.iter().position(|p| Some(p.tail) == keep) {
        candidates[..=i].rotate_right(1);
    }
    if let Some(p) = candidates.iter().find(|p| p.card.inside(&area)) {
        return *p;
    }
    // Nothing fits whole: keep each on the display and take the one that covers him least.
    candidates
        .iter()
        .map(|p| Placed { card: Rect { x: clamp_x(p.card.x), y: clamp_y(p.card.y), ..p.card }, ..*p })
        .min_by(|a, b| a.card.overlap(&body).total_cmp(&b.card.overlap(&body)))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAP: f64 = 12.0;
    const INSET: f64 = 18.0;

    fn screen(scale: f64) -> Rect {
        // 1920 × 1080 at 100%, a taskbar at the bottom.
        Rect { x: 0.0, y: 0.0, w: 1920.0 * scale, h: 1032.0 * scale }
    }

    /// A character's body: his square at (x, y) with `side`, and his hit box as fractions of it.
    fn body(x: f64, y: f64, side: f64, hit: (f64, f64, f64, f64)) -> Rect {
        Rect { x: x + hit.0 * side, y: y + hit.1 * side, w: (hit.2 - hit.0) * side, h: (hit.3 - hit.1) * side }
    }

    fn clear_of(p: &Placed, b: &Rect, area: &Rect) {
        assert!(p.card.inside(area), "off screen: {p:?} on {area:?}");
        assert_eq!(p.card.overlap(b), 0.0, "covers him: {p:?} over {b:?}");
        let gap = (p.card.x - b.right()).max(b.x - p.card.right()).max(p.card.y - b.bottom()).max(b.y - p.card.bottom());
        assert!(gap >= GAP - 0.5, "too close ({gap}): {p:?} by {b:?}");
    }

    #[test]
    fn never_covers_him_anywhere_on_screen() {
        // Kulhi, Dogesh 2D, and a 3D character wandering past his square.
        let hits = [(0.24, 0.35, 0.76, 0.92), (0.32, 0.25, 0.77, 0.9), (-0.6, 0.1, -0.1, 0.95)];
        let cards = [(220.0, 64.0), (310.0, 150.0), (310.0, 290.0)];
        for scale in [1.0, 1.5] {
            let area = screen(scale);
            for side in [120.0, 160.0, 210.0] {
                let side = side * scale;
                for hit in hits {
                    for (w, h) in cards {
                        let (w, h) = (w * scale, h * scale);
                        let mut x = 0.0;
                        while x <= area.w - side {
                            let mut y = 0.0;
                            while y <= area.h - side {
                                let b = body(x, y, side, hit);
                                if b.x >= area.x && b.right() <= area.right() {
                                    let p = place_card(b, w, h, area, GAP * scale, INSET, None);
                                    clear_of(&p, &b, &area);
                                }
                                y += 37.0 * scale;
                            }
                            x += 53.0 * scale;
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn beside_him_on_the_roomier_side_with_the_tail_at_his_face() {
        let area = screen(1.0);
        // Bottom-right corner (the default spot): the card opens to his left.
        let b = body(1744.0, 872.0, 160.0, (0.24, 0.35, 0.76, 0.92));
        let p = place_card(b, 300.0, 90.0, area, GAP, INSET, None);
        assert_eq!(p.tail, Tail::Right);
        assert_eq!(p.card.right(), b.x - GAP);
        assert!((p.card.y + p.tail_at - (b.y + b.h * 0.3)).abs() < 0.5, "tail points at his face");
        // Left side of the screen: it opens to his right.
        let b = body(20.0, 400.0, 160.0, (0.24, 0.35, 0.76, 0.92));
        assert_eq!(place_card(b, 300.0, 90.0, area, GAP, INSET, None).tail, Tail::Left);
    }

    #[test]
    fn above_or_below_when_neither_side_fits() {
        // A display barely wider than him.
        let area = Rect { x: 0.0, y: 0.0, w: 400.0, h: 900.0 };
        let b = Rect { x: 100.0, y: 500.0, w: 200.0, h: 200.0 };
        let p = place_card(b, 300.0, 100.0, area, GAP, INSET, None);
        assert_eq!(p.tail, Tail::Bottom);
        assert_eq!(p.card.bottom(), b.y - GAP);
        let b = Rect { y: 40.0, ..b };
        assert_eq!(place_card(b, 300.0, 100.0, area, GAP, INSET, None).tail, Tail::Top);
    }

    #[test]
    fn keeps_its_side_while_that_still_fits() {
        let area = screen(1.0);
        // He's left of centre, so the card would open to his right...
        let b = body(700.0, 500.0, 160.0, (0.24, 0.35, 0.76, 0.92));
        assert_eq!(place_card(b, 300.0, 90.0, area, GAP, INSET, None).tail, Tail::Left);
        // ...but it was on his left, and there's room there: it stays.
        let p = place_card(b, 300.0, 90.0, area, GAP, INSET, Some(Tail::Right));
        assert_eq!(p.tail, Tail::Right);
        clear_of(&p, &b, &area);
        // No room left of him any more: it moves.
        let b = body(100.0, 500.0, 160.0, (0.24, 0.35, 0.76, 0.92));
        assert_eq!(place_card(b, 300.0, 90.0, area, GAP, INSET, Some(Tail::Right)).tail, Tail::Left);
    }

    #[test]
    fn stays_on_screen_when_nothing_fits() {
        let area = Rect { x: 0.0, y: 0.0, w: 300.0, h: 300.0 };
        let b = Rect { x: 50.0, y: 50.0, w: 200.0, h: 200.0 };
        let p = place_card(b, 280.0, 120.0, area, GAP, INSET, None);
        assert!(p.card.inside(&area));
    }
}
